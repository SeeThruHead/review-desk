import type {
  Activity,
  Agent,
  Card,
  Delivered,
  Outcome,
  Relation,
  Role,
  Round,
  Settled,
  Stage,
  ThreadView,
  Triage
} from "@review-desk/contract/Board.ts"
import { Count, IsoTime, Text } from "@review-desk/contract/Ids.ts"
import { Array, Option } from "effect"
import type { PullFacts, Review, Side, Thread } from "./Facts.ts"
import { type Marker, excerpt, isFromAgent, markerOf } from "./Protocol.ts"

export type ThreadState =
  | { readonly _tag: "Human" }
  | { readonly _tag: "Settled"; readonly outcome: Outcome; readonly note: string }
  | { readonly _tag: "Open"; readonly round: number; readonly waitingOn: Side }
  | { readonly _tag: "AtLimit"; readonly round: number }

const markersIn = (thread: Thread): ReadonlyArray<Marker> =>
  thread.comments.flatMap((comment) => Option.toArray(markerOf(comment.body)))

export const threadState = (thread: Thread, limit: number): ThreadState => {
  const markers = markersIn(thread)
  const last = Array.last(thread.comments)
  const lastMarker = Option.flatMap(last, (comment) => markerOf(comment.body))
  const note = Option.match(last, { onNone: () => "", onSome: (comment) => excerpt(comment.body) })
  const round = Math.max(0, ...markers.map((marker) => marker.round))

  if (markers.length === 0) return { _tag: "Human" }
  if (thread.resolved) return { _tag: "Settled", outcome: settledAs(lastMarker), note }
  if (Option.isNone(lastMarker)) return { _tag: "Human" }
  if (lastMarker.value.outcome !== "open") return { _tag: "Settled", outcome: lastMarker.value.outcome, note }
  if (lastMarker.value.side === "author" && round >= limit) return { _tag: "AtLimit", round }

  return { _tag: "Open", round, waitingOn: lastMarker.value.side === "reviewer" ? "author" : "reviewer" }
}

export const answeredByCommit = (thread: Thread, limit: number): boolean => {
  if (thread.changedSince !== true) return false
  const state = threadState(thread, limit)

  return state._tag === "Open" && state.waitingOn === "author"
}

const settledAs = (marker: Option.Option<Marker>): Outcome =>
  Option.match(marker, {
    onNone: () => "fixed",
    onSome: (found) => (found.outcome === "open" ? "fixed" : found.outcome)
  })

const isHumanReview = (review: Review): boolean => {
  if (isFromAgent(review.body)) return false
  if (review.state === "approved" || review.state === "changes_requested") return true

  return review.state === "commented" && review.body.trim().length > 0
}

const humanReviewed = (facts: PullFacts, role: Role, logins: ReadonlyArray<string>): boolean =>
  facts.reviews
    .filter(isHumanReview)
    .some((review) => role === "author" || logins.some((login) => login.toLowerCase() === review.author.toLowerCase()))

const reviewerPosted = (facts: PullFacts): boolean =>
  [
    ...facts.reviews.map((review) => review.body),
    ...facts.comments.map((comment) => comment.body),
    ...facts.threads.flatMap((thread) => thread.comments.map((comment) => comment.body))
  ]
    .flatMap((body) => Option.toArray(markerOf(body)))
    .some((marker) => marker.side === "reviewer")

export type Desk = { readonly logins: ReadonlyArray<string>; readonly limit: number; readonly intakeLabel: string }

export type Context = {
  readonly role: Role
  readonly trusted: boolean
  readonly claimed: boolean
  readonly triage: Triage | null
  readonly agent: Agent | null
  readonly relations: ReadonlyArray<Relation>
  readonly delivered: Delivered | null
}

const sideOf = (role: Role): Side => (role === "reviewer" ? "reviewer" : "author")

const asked = (facts: PullFacts, desk: Desk): boolean =>
  facts.requested.length > 0 || facts.labels.some((label) => label === desk.intakeLabel)

const quietStage = (facts: PullFacts, desk: Desk, context: Context): Stage => {
  if (context.claimed) return "reviewing"

  return asked(facts, desk) ? "requested" : "waiting"
}

export const stageOf = (facts: PullFacts, desk: Desk, context: Context, states: ReadonlyArray<ThreadState>): Stage => {
  if (facts.state === "merged") return "merged"
  if (humanReviewed(facts, context.role, desk.logins)) return "reviewed"
  if (states.some((state) => state._tag === "Open")) return "talking"
  if (!reviewerPosted(facts)) return quietStage(facts, desk, context)
  if (context.role === "reviewer" && context.triage === null) return "reviewing"

  return "ready"
}

const roundOf = (states: ReadonlyArray<ThreadState>, desk: Desk, role: Role): Round | null => {
  const open = states.flatMap((state) => (state._tag === "Open" ? [state] : []))

  return Option.match(Array.last(open), {
    onNone: () => null,
    onSome: (latest) => ({
      number: Count.make(Math.max(...open.map((state) => state.round))),
      limit: Count.make(desk.limit),
      turn: latest.waitingOn === sideOf(role) ? "mine" : "theirs"
    })
  })
}

const settledOf = (thread: Thread, state: ThreadState): ReadonlyArray<Settled> =>
  state._tag === "Settled"
    ? [{ thread: Text.make(thread.path), outcome: state.outcome, note: Text.make(state.note) }]
    : []

const latestText = (thread: Thread): Text =>
  Text.make(excerpt(thread.comments.reduce((_, comment) => comment.body, "")))

const viewOf = (thread: Thread, state: ThreadState, role: Role): ReadonlyArray<ThreadView> => {
  const base = {
    thread: Text.make(thread.path),
    round: Count.make(Math.max(0, ...markersIn(thread).map((marker) => marker.round))),
    latest: latestText(thread)
  }
  if (state._tag === "Human") return []
  if (state._tag === "Settled") return [{ ...base, status: "settled", outcome: state.outcome, turn: null }]
  if (state._tag === "AtLimit") return [{ ...base, status: "for-you", outcome: null, turn: null }]

  return [{ ...base, status: "open", outcome: null, turn: state.waitingOn === sideOf(role) ? "mine" : "theirs" }]
}

const agentBodies = (facts: PullFacts): ReadonlyArray<{ readonly body: string; readonly at: string }> => [
  ...facts.reviews.map((review) => ({ body: review.body, at: review.at })),
  ...facts.comments.map((comment) => ({ body: comment.body, at: comment.at })),
  ...facts.threads.flatMap((thread) => thread.comments.map((comment) => ({ body: comment.body, at: comment.at })))
]

export const activityOf = (facts: PullFacts): Activity | null => {
  const latest = Array.last(
    agentBodies(facts)
      .flatMap((entry) =>
        Option.toArray(Option.map(markerOf(entry.body), (marker) => ({ ...entry, side: marker.side })))
      )
      .toSorted((a, b) => a.at.localeCompare(b.at))
  )

  return Option.match(latest, {
    onNone: () => null,
    onSome: (entry) => ({ side: entry.side, text: Text.make(excerpt(entry.body)), at: IsoTime.make(entry.at) })
  })
}

export const cardOf = (facts: PullFacts, desk: Desk, context: Context): Card => {
  const threads = facts.threads.map((thread) => ({ thread, state: threadState(thread, desk.limit) }))
  const states = threads.map((entry) => entry.state)
  const stage = stageOf(facts, desk, context, states)

  return {
    key: facts.key,
    forge: facts.forge,
    repo: facts.repo,
    number: facts.number,
    title: facts.title,
    url: facts.url,
    author: facts.author,
    role: context.role,
    stage,
    trusted: context.trusted,
    round: roundOf(states, desk, context.role),
    agent: context.agent,
    triage: context.triage,
    settled: threads.flatMap((entry) => settledOf(entry.thread, entry.state)),
    openThreads: Count.make(states.filter((state) => state._tag === "Open" || state._tag === "AtLimit").length),
    relations: context.relations,
    checks: facts.checks,
    updatedAt: facts.updatedAt,
    threads: threads.flatMap((entry) => viewOf(entry.thread, entry.state, context.role)),
    activity: activityOf(facts),
    claimed: context.claimed,
    review: facts.review,
    queue: facts.queue,
    attention: null,
    delivered: context.delivered
  }
}
