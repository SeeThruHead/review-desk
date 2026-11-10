import type { Agent, Board, Card, Role } from "@review-desk/contract/Board.ts"
import type { SessionName } from "@review-desk/contract/Ids.ts"
import type { PullFacts, Side } from "@review-desk/domain/Facts.ts"
import { cardOf, threadState } from "@review-desk/domain/Lifecycle.ts"
import { markerOf } from "@review-desk/domain/Protocol.ts"
import { readyOrder, relationsOf } from "@review-desk/domain/Relations.ts"
import { isTrustedPerson, isTrustedRepo, mayReachAgent } from "@review-desk/domain/Trust.ts"
import { Option } from "effect"
import type { LiveAgent } from "../agents/Agents.ts"
import { type AgentTarget, targetFor } from "../agents/Remote.ts"
import type { Area, DeskSettings } from "../config/DeskConfig.ts"
import type { Records } from "../store/DeskRepo.ts"
import { type Brief, type Item, routingBrief, updateMessage } from "./Messages.ts"

export type Settings = Pick<
  DeskSettings,
  "desk" | "aliases" | "owner" | "roles" | "repos" | "people" | "areas" | "roundLimit" | "intakeLabel" | "sidediff"
>

export type Inputs = {
  readonly settings: Settings
  readonly facts: ReadonlyArray<PullFacts>
  readonly records: Records
  readonly agents: ReadonlyArray<LiveAgent>
}

export type Route = {
  readonly pull: PullFacts
  readonly session: SessionName
  readonly target: AgentTarget
  readonly message: string
  readonly items: ReadonlyArray<string>
}

export type Delivery = {
  readonly pull: PullFacts
  readonly agent: AgentTarget
  readonly message: string
  readonly items: ReadonlyArray<string>
}

export type Remember = { readonly pull: PullFacts; readonly items: ReadonlyArray<string> }

export type Plan = {
  readonly cards: ReadonlyArray<Card>
  readonly ready: Board["ready"]
  readonly routes: ReadonlyArray<Route>
  readonly deliveries: ReadonlyArray<Delivery>
  readonly remember: ReadonlyArray<Remember>
}

type Keyed = Item & { readonly key: string }

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const loginsOf = (settings: Settings): ReadonlyArray<string> => [settings.desk, ...settings.aliases]

const isMe = (settings: Settings, login: string): boolean => loginsOf(settings).some((mine) => same(mine, login))

const isAsked = (settings: Settings, pull: PullFacts): boolean => {
  if (pull.requested.some((login) => isMe(settings, login))) return true

  return pull.labels.some((label) => label === settings.intakeLabel)
}

export const roleOf = (settings: Settings, pull: PullFacts, records: Records): Role | null => {
  if (settings.roles.includes("author") && isMe(settings, pull.author)) return "author"
  if (!settings.roles.includes("reviewer")) return null
  if (records.claims.has(pull.key)) return "reviewer"

  return isAsked(settings, pull) ? "reviewer" : null
}

const sideOf = (role: Role): Side => (role === "reviewer" ? "reviewer" : "author")

const remoteMatches = (agent: LiveAgent, pull: PullFacts): boolean =>
  Option.match(agent.remote, {
    onNone: () => false,
    onSome: (remote) => remote.toLowerCase().includes(pull.repo.toLowerCase())
  })

const onBranch = (agent: LiveAgent, pull: PullFacts): boolean =>
  remoteMatches(agent, pull) && Option.getOrElse(agent.branch, () => "") === pull.head

export const agentFor = (
  pull: PullFacts,
  role: Role,
  records: Records,
  agents: ReadonlyArray<LiveAgent>
): LiveAgent | undefined => {
  if (role === "author") return agents.find((agent) => onBranch(agent, pull))
  const session = records.claims.get(pull.key)

  return agents.find((agent) => agent.name === session)
}

const cardAgent = (pull: PullFacts, role: Role, records: Records, agents: ReadonlyArray<LiveAgent>): Agent | null => {
  const live = agentFor(pull, role, records, agents)
  if (live !== undefined) return { session: live.name, working: live.working }
  const session = records.claims.get(pull.key)

  return role === "reviewer" && session !== undefined ? { session, working: false } : null
}

const touches = (area: Area, pull: PullFacts): boolean => {
  if (area.paths === undefined) return true
  const paths = area.paths

  return pull.files.some((file) => paths.some((prefix) => file.startsWith(prefix)))
}

export const areaFor = (settings: Settings, pull: PullFacts): Area | undefined =>
  settings.areas.find((area) => area.repos.some((repo) => same(repo, pull.repo)) && touches(area, pull))

export const itemsOf = (pull: PullFacts): ReadonlyArray<Keyed> => [
  ...pull.comments.map((comment) => ({ key: `c:${comment.id}`, comment, path: null, line: null })),
  ...pull.reviews
    .filter((review) => review.body.trim().length > 0)
    .map((review) => ({
      key: `r:${review.id}`,
      comment: { id: review.id, author: review.author, body: review.body, at: review.at, url: review.url },
      path: null,
      line: null
    })),
  ...pull.threads.flatMap((thread) =>
    thread.comments.map((comment) => ({ key: `t:${comment.id}`, comment, path: thread.path, line: thread.line }))
  )
]

const atLimit = (pull: PullFacts, limit: number): ReadonlySet<string> =>
  new Set(
    pull.threads
      .filter((thread) => threadState(thread, limit)._tag === "AtLimit")
      .flatMap((thread) => thread.comments.map((comment) => `t:${comment.id}`))
  )

const forMe = (settings: Settings, side: Side, item: Keyed): boolean =>
  Option.match(markerOf(item.comment.body), {
    onNone: () => !isMe(settings, item.comment.author) && isTrustedPerson(settings, item.comment.author),
    onSome: (marker) => marker.side !== side
  })

const brief = (settings: Settings): Brief => ({
  owner: settings.owner,
  limit: settings.roundLimit,
  desk: settings.desk
})

const trustedPull = (settings: Settings, pull: PullFacts, role: Role): boolean =>
  role === "author" ? isTrustedRepo(settings, pull.forge, pull.repo) : mayReachAgent(settings, pull, pull.author)

type Considered = { readonly pull: PullFacts; readonly role: Role; readonly trusted: boolean }

const routeOf = (input: Inputs, entry: Considered): ReadonlyArray<Route> => {
  if (entry.role !== "reviewer" || !entry.trusted || entry.pull.state !== "open") return []
  if (input.records.claims.has(entry.pull.key)) return []
  const area = areaFor(input.settings, entry.pull)
  if (area === undefined) return []

  return [
    {
      pull: entry.pull,
      session: area.session,
      target: targetFor(area.session, input.agents),
      message: routingBrief(entry.pull, brief(input.settings)),
      items: itemsOf(entry.pull).map((item) => item.key)
    }
  ]
}

const deliveryOf = (
  input: Inputs,
  entry: Considered
): { readonly deliveries: ReadonlyArray<Delivery>; readonly remember: ReadonlyArray<Remember> } => {
  const { pull, role } = entry
  const nothing = { deliveries: [], remember: [] }
  if (!entry.trusted || pull.state !== "open") return nothing
  if (role === "reviewer" && !input.records.claims.has(pull.key)) return nothing
  const all = itemsOf(pull)
  if (!input.records.known.has(pull.key))
    return { deliveries: [], remember: [{ pull, items: all.map((item) => item.key) }] }

  const limited = atLimit(pull, input.settings.roundLimit)
  const fresh = all.filter((item) => !input.records.seen.has(`${pull.key} ${item.key}`))
  const wanted = fresh.filter((item) => forMe(input.settings, sideOf(role), item) && !limited.has(item.key))
  const failedChecks = role === "author" && pull.checks === "failed" && input.records.known.get(pull.key) !== "failed"
  const agent = agentFor(pull, role, input.records, input.agents)
  const skipped = { pull, items: fresh.filter((item) => !wanted.includes(item)).map((item) => item.key) }

  if (wanted.length === 0 && !failedChecks) return { deliveries: [], remember: [skipped] }
  if (agent === undefined) return { deliveries: [], remember: [skipped] }

  return {
    deliveries: [
      {
        pull,
        agent: { machine: agent.machine, pane: agent.pane },
        message: updateMessage(pull, role, wanted, failedChecks, brief(input.settings)),
        items: wanted.map((item) => item.key)
      }
    ],
    remember: [skipped]
  }
}

export const plan = (input: Inputs): Plan => {
  const considered = input.facts.flatMap((pull) => {
    const role = roleOf(input.settings, pull, input.records)

    return role === null ? [] : [{ pull, role, trusted: trustedPull(input.settings, pull, role) }]
  })
  const desk = {
    logins: loginsOf(input.settings),
    limit: input.settings.roundLimit,
    intakeLabel: input.settings.intakeLabel
  }
  const cards = considered.map((entry) =>
    cardOf(entry.pull, desk, {
      role: entry.role,
      trusted: entry.trusted,
      claimed: input.records.claims.has(entry.pull.key),
      triage: input.records.triage.get(entry.pull.key)?.triage ?? null,
      agent: entry.trusted ? cardAgent(entry.pull, entry.role, input.records, input.agents) : null,
      relations: relationsOf(entry.pull, input.facts)
    })
  )
  const handled = considered.map((entry) => deliveryOf(input, entry))

  return {
    cards,
    ready: readyOrder(cards),
    routes: considered.flatMap((entry) => routeOf(input, entry)),
    deliveries: handled.flatMap((entry) => entry.deliveries),
    remember: handled.flatMap((entry) => entry.remember)
  }
}
