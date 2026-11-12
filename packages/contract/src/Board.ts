import { Schema } from "effect"
import { Count, Forge, IsoTime, Login, PrKey, PrNumber, RepoSlug, SessionName, Text, Url } from "./Ids.ts"

export const Role = Schema.Literals(["author", "reviewer"])
export type Role = typeof Role.Type

export const Stage = Schema.Literals(["waiting", "requested", "reviewing", "talking", "ready", "reviewed", "merged"])
export type Stage = typeof Stage.Type

export const Verdict = Schema.Literals(["architecture", "look", "skim"])
export type Verdict = typeof Verdict.Type

export const Turn = Schema.Literals(["mine", "theirs"])
export type Turn = typeof Turn.Type

export const Checks = Schema.Literals(["passed", "failed", "pending", "none"])
export type Checks = typeof Checks.Type

export const Outcome = Schema.Literals(["fixed", "answered", "dropped"])
export type Outcome = typeof Outcome.Type

export const RelationKind = Schema.Literals(["stacked-on", "conflicts-with", "depends-on"])
export type RelationKind = typeof RelationKind.Type

export const Round = Schema.Struct({ number: Count, limit: Count, turn: Turn })
export type Round = typeof Round.Type

export const Agent = Schema.Struct({ session: SessionName, working: Schema.Boolean })
export type Agent = typeof Agent.Type

export const Triage = Schema.Struct({ verdict: Verdict, reason: Text })
export type Triage = typeof Triage.Type

export const Settled = Schema.Struct({ thread: Text, outcome: Outcome, note: Text })
export type Settled = typeof Settled.Type

export const Relation = Schema.Struct({ kind: RelationKind, with: PrKey, label: Text })
export type Relation = typeof Relation.Type

export const ThreadStatus = Schema.Literals(["open", "settled", "for-you"])
export type ThreadStatus = typeof ThreadStatus.Type

export const ThreadView = Schema.Struct({
  thread: Text,
  status: ThreadStatus,
  outcome: Schema.NullOr(Outcome),
  round: Count,
  turn: Schema.NullOr(Turn),
  latest: Text
})
export type ThreadView = typeof ThreadView.Type

export const AgentSide = Schema.Literals(["reviewer", "author"])

export const Activity = Schema.Struct({ side: AgentSide, text: Text, at: IsoTime })
export type Activity = typeof Activity.Type

export const ReviewDecision = Schema.Literals(["approved", "changes_requested", "review_required"])
export type ReviewDecision = typeof ReviewDecision.Type

export const MergeQueue = Schema.Struct({ state: Text, position: Schema.NullOr(Count) })
export type MergeQueue = typeof MergeQueue.Type

export const Attention = Schema.Struct({ why: Text, at: IsoTime })
export type Attention = typeof Attention.Type

export const Delivered = Schema.Struct({ text: Text, at: IsoTime })
export type Delivered = typeof Delivered.Type

export const Card = Schema.Struct({
  key: PrKey,
  forge: Forge,
  repo: RepoSlug,
  number: PrNumber,
  title: Text,
  url: Url,
  author: Login,
  role: Role,
  stage: Stage,
  trusted: Schema.Boolean,
  round: Schema.NullOr(Round),
  agent: Schema.NullOr(Agent),
  triage: Schema.NullOr(Triage),
  settled: Schema.Array(Settled),
  openThreads: Count,
  relations: Schema.Array(Relation),
  checks: Checks,
  updatedAt: IsoTime,
  threads: Schema.optionalKey(Schema.Array(ThreadView)),
  activity: Schema.optionalKey(Schema.NullOr(Activity)),
  claimed: Schema.Boolean,
  review: Schema.NullOr(ReviewDecision),
  queue: Schema.NullOr(MergeQueue),
  attention: Schema.NullOr(Attention),
  delivered: Schema.NullOr(Delivered)
})
export type Card = typeof Card.Type

export const MentionKind = Schema.Literals(["pull", "issue"])
export type MentionKind = typeof MentionKind.Type

export const Mention = Schema.Struct({
  key: PrKey,
  kind: MentionKind,
  forge: Forge,
  repo: RepoSlug,
  number: PrNumber,
  title: Text,
  url: Url,
  by: Login,
  text: Text,
  at: IsoTime,
  attention: Schema.NullOr(Attention)
})
export type Mention = typeof Mention.Type

export const HealthState = Schema.Literals(["live", "stale", "paused"])
export type HealthState = typeof HealthState.Type

export const Health = Schema.Struct({
  state: HealthState,
  reason: Schema.NullOr(Text),
  lastGood: Schema.NullOr(IsoTime),
  until: Schema.NullOr(IsoTime)
})
export type Health = typeof Health.Type

export const Routing = Schema.Struct({ on: Schema.Boolean, reason: Schema.NullOr(Text) })
export type Routing = typeof Routing.Type

export const Budget = Schema.Struct({ remaining: Count, limit: Count, resetAt: IsoTime, slowed: Schema.Boolean })
export type Budget = typeof Budget.Type

export const Board = Schema.Struct({
  desk: Login,
  cards: Schema.Array(Card),
  ready: Schema.Array(PrKey),
  sidediff: Schema.Boolean,
  polledAt: Schema.NullOr(IsoTime),
  mentions: Schema.Array(Mention),
  health: Health,
  routing: Routing,
  budget: Schema.NullOr(Budget)
})
export type Board = typeof Board.Type
