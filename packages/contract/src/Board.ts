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
  activity: Schema.optionalKey(Schema.NullOr(Activity))
})
export type Card = typeof Card.Type

export const Board = Schema.Struct({
  desk: Login,
  cards: Schema.Array(Card),
  ready: Schema.Array(PrKey),
  sidediff: Schema.Boolean,
  polledAt: Schema.NullOr(IsoTime)
})
export type Board = typeof Board.Type
