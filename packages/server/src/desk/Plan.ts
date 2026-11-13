import type { Agent, Board, Card, Mention, Role, Routing } from "@review-desk/contract/Board.ts"
import { SessionName, Text } from "@review-desk/contract/Ids.ts"
import { type Me, attentionOf, issueMention, pullMention } from "@review-desk/domain/Attention.ts"
import type { IssueFacts, PullFacts, Side } from "@review-desk/domain/Facts.ts"
import { cardOf, threadState } from "@review-desk/domain/Lifecycle.ts"
import { markerOf } from "@review-desk/domain/Protocol.ts"
import { readyOrder, relationsOf } from "@review-desk/domain/Relations.ts"
import { isTrustedPerson, isTrustedRepo, mayReachAgent } from "@review-desk/domain/Trust.ts"
import { Option } from "effect"
import type { LiveAgent } from "../agents/Agents.ts"
import { type Refusals, pickAgent, targetFor } from "../agents/Directory.ts"
import type { AgentTarget } from "../agents/Remote.ts"
import { type Area, type DeskSettings, areaAgent } from "../config/DeskConfig.ts"
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
  readonly issues?: ReadonlyArray<IssueFacts>
  readonly refused?: Refusals
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
  readonly note: string
  readonly items: ReadonlyArray<string>
}

export type Remember = { readonly pull: PullFacts; readonly items: ReadonlyArray<string> }

export type Plan = {
  readonly cards: ReadonlyArray<Card>
  readonly ready: Board["ready"]
  readonly mentions: ReadonlyArray<Mention>
  readonly routing: Routing
  readonly routes: ReadonlyArray<Route>
  readonly deliveries: ReadonlyArray<Delivery>
  readonly remember: ReadonlyArray<Remember>
}

type Keyed = Item & { readonly key: string }

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const loginsOf = (settings: Settings): ReadonlyArray<string> => [settings.desk, ...settings.aliases]

const isMe = (settings: Settings, login: string): boolean => loginsOf(settings).some((mine) => same(mine, login))

export const isAsked = (settings: Settings, pull: PullFacts): boolean => {
  if (pull.requested.some((login) => isMe(settings, login))) return true

  return pull.labels.some((label) => label === settings.intakeLabel)
}

export const roleOf = (settings: Settings, pull: PullFacts, records: Records): Role | null => {
  if (records.claimRoles.get(pull.key) === "author") return "author"
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

const noRefusals: Refusals = new Map()

const refusalsOf = (input: Inputs): Refusals => input.refused ?? noRefusals

const claimedAgent = (claimed: string, agents: ReadonlyArray<LiveAgent>, refused: Refusals): LiveAgent | undefined => {
  const picked = pickAgent(claimed, agents, refused)

  return picked._tag === "One" ? picked.agent : undefined
}

export const agentFor = (
  pull: PullFacts,
  role: Role,
  records: Records,
  agents: ReadonlyArray<LiveAgent>,
  refused: Refusals
): LiveAgent | undefined => {
  const claimed = claimFor(pull, role, records)
  if (claimed !== undefined) return claimedAgent(claimed, agents, refused)
  if (role === "author") return agents.find((agent) => onBranch(agent, pull))

  return undefined
}

const claimFor = (pull: PullFacts, role: Role, records: Records): SessionName | undefined => {
  const session = records.claims.get(pull.key)
  if (session === undefined) return undefined

  return (records.claimRoles.get(pull.key) ?? "reviewer") === role ? session : undefined
}

const cardAgent = (pull: PullFacts, role: Role, input: Inputs): Agent | null => {
  const { records } = input
  const live = agentFor(pull, role, records, input.agents, refusalsOf(input))
  if (live !== undefined) return { session: live.name, working: live.working }
  const session = claimFor(pull, role, records)

  return session === undefined ? null : { session, working: false }
}

const pushKey = (pull: PullFacts): string => `h:${pull.headSha}`

const seenAnyPush = (records: Records, pull: PullFacts): boolean =>
  [...records.seen].some((entry) => entry.startsWith(`${pull.key} h:`))

const newPush = (records: Records, pull: PullFacts, role: Role): boolean => {
  if (role !== "reviewer") return false
  if (!seenAnyPush(records, pull)) return false

  return !records.seen.has(`${pull.key} ${pushKey(pull)}`)
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

const plural = (count: number, word: string): string => (count === 1 ? `1 ${word}` : `${count} ${word}s`)

export const deliveryNote = (comments: number, change: { readonly failedChecks: boolean; readonly pushed: boolean }) =>
  [
    ...(change.failedChecks ? ["the CI failure"] : []),
    ...(change.pushed ? ["the new commits"] : []),
    ...(comments > 0 ? [plural(comments, "comment")] : [])
  ].join(" and ")

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
  const wanted = areaAgent(area)
  const targeted = targetFor(wanted, input.agents, refusalsOf(input))
  if (targeted._tag === "Refused") return []

  return [
    {
      pull: entry.pull,
      session: SessionName.make(wanted),
      target: targeted.target,
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
    return { deliveries: [], remember: [{ pull, items: [...all.map((item) => item.key), pushKey(pull)] }] }

  const limited = atLimit(pull, input.settings.roundLimit)
  const fresh = all.filter((item) => !input.records.seen.has(`${pull.key} ${item.key}`))
  const wanted = fresh.filter((item) => forMe(input.settings, sideOf(role), item) && !limited.has(item.key))
  const failedChecks = role === "author" && pull.checks === "failed" && input.records.known.get(pull.key) !== "failed"
  const pushed = newPush(input.records, pull, role)
  const agent = agentFor(pull, role, input.records, input.agents, refusalsOf(input))
  const unwanted = fresh.filter((item) => !wanted.includes(item)).map((item) => item.key)
  const skipped = { pull, items: [...unwanted, pushKey(pull)] }

  if (wanted.length === 0 && !failedChecks && !pushed) return { deliveries: [], remember: [skipped] }
  if (agent === undefined) return { deliveries: [], remember: [pushed ? { pull, items: unwanted } : skipped] }

  return {
    deliveries: [
      {
        pull,
        agent: { machine: agent.machine, pane: agent.pane },
        message: updateMessage(pull, role, wanted, { failedChecks, pushed }, brief(input.settings)),
        note: `Sent ${deliveryNote(wanted.length, { failedChecks, pushed })}`,
        items: wanted.map((item) => item.key)
      }
    ],
    remember: [skipped]
  }
}

const queueKey = (pull: PullFacts): string => `q:${pull.headSha}`

export const leftQueue = (records: Records, pull: PullFacts): boolean => {
  if (pull.state !== "open" || pull.queue !== null) return false

  return records.seen.has(`${pull.key} ${queueKey(pull)}`)
}

const queueMemory = (records: Records, pull: PullFacts): ReadonlyArray<Remember> => {
  if (pull.queue === null || !records.known.has(pull.key)) return []

  return [{ pull, items: [queueKey(pull)] }]
}

const uncoveredRepos = (settings: Settings, considered: ReadonlyArray<Considered>): ReadonlyArray<string> => [
  ...new Set(
    considered
      .filter((entry) => entry.role === "reviewer" && entry.pull.state === "open" && isAsked(settings, entry.pull))
      .filter((entry) => areaFor(settings, entry.pull) === undefined)
      .map((entry) => entry.pull.repo)
  )
]

export const routingOf = (settings: Settings, considered: ReadonlyArray<Considered>): Routing => {
  if (settings.areas.length === 0)
    return { on: false, reason: Text.make("No areas configured, so review requests stay with you") }
  const uncovered = uncoveredRepos(settings, considered)
  if (uncovered.length === 0) return { on: true, reason: null }

  return {
    on: true,
    reason: Text.make(`No area covers ${uncovered.join(", ")}, so review requests there stay with you`)
  }
}

const mentionsOf = (input: Inputs, me: Me, considered: ReadonlyArray<Considered>): ReadonlyArray<Mention> => {
  const carded = new Set(considered.map((entry) => entry.pull.key))
  const seenAt = (key: string) => input.records.seenAt.get(key) ?? null

  return [
    ...input.facts.filter((pull) => !carded.has(pull.key)).flatMap((pull) => pullMention(me, pull, seenAt(pull.key))),
    ...(input.issues ?? []).flatMap((issue) =>
      issueMention(me, issue, seenAt(`${issue.forge}:${issue.repo}#${issue.number}`))
    )
  ]
}

const unroutedReason = (input: Inputs, entry: Considered): string | null => {
  if (entry.role !== "reviewer" || input.records.claims.has(entry.pull.key)) return null
  const area = areaFor(input.settings, entry.pull)
  if (area === undefined) return null
  const targeted = targetFor(areaAgent(area), input.agents, refusalsOf(input))

  return targeted._tag === "Refused" ? targeted.reason : null
}

const cardFor = (input: Inputs, me: Me, entry: Considered): Card => {
  const { pull } = entry
  const card = cardOf(
    pull,
    { logins: me.logins, limit: input.settings.roundLimit, intakeLabel: input.settings.intakeLabel },
    {
      role: entry.role,
      trusted: entry.trusted,
      claimed: input.records.claims.has(pull.key),
      triage: input.records.triage.get(pull.key)?.triage ?? null,
      agent: entry.trusted ? cardAgent(pull, entry.role, input) : null,
      relations: relationsOf(pull, input.facts),
      delivered: input.records.delivered.get(pull.key) ?? null
    }
  )
  const look = {
    facts: pull,
    card,
    me,
    asked: isAsked(input.settings, pull),
    covered: areaFor(input.settings, pull) !== undefined,
    unrouted: unroutedReason(input, entry),
    leftQueue: leftQueue(input.records, pull)
  }

  return { ...card, attention: attentionOf(look, input.records.seenAt.get(pull.key) ?? null) }
}

export const plan = (input: Inputs): Plan => {
  const considered = input.facts.flatMap((pull) => {
    const role = roleOf(input.settings, pull, input.records)

    return role === null ? [] : [{ pull, role, trusted: trustedPull(input.settings, pull, role) }]
  })
  const me = { logins: loginsOf(input.settings) }
  const cards = considered.map((entry) => cardFor(input, me, entry))
  const handled = considered.map((entry) => deliveryOf(input, entry))

  return {
    cards,
    ready: readyOrder(cards),
    mentions: mentionsOf(input, me, considered),
    routing: routingOf(input.settings, considered),
    routes: considered.flatMap((entry) => routeOf(input, entry)),
    deliveries: handled.flatMap((entry) => entry.deliveries),
    remember: [
      ...handled.flatMap((entry) => entry.remember),
      ...considered.flatMap((entry) => queueMemory(input.records, entry.pull))
    ]
  }
}
