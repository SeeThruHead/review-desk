import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { Board, Health, Role, Routing, Settled, Verdict } from "./Board.ts"
import { Count, Forge, Login, PrKey, RepoSlug, SessionName, Text, Url } from "./Ids.ts"

export class UnknownPull extends Schema.TaggedError<UnknownPull, { readonly brand: unique symbol }>()("UnknownPull", {
  key: PrKey
}) {
  override get message() {
    return `Review Desk is not watching ${this.key}; check the repository is in the config and the pull request is open`
  }
}

export class SidediffFailed extends Schema.TaggedError<SidediffFailed, { readonly brand: unique symbol }>()(
  "SidediffFailed",
  { key: PrKey, reason: Text }
) {
  override get message() {
    return `sidediff could not open ${this.key}: ${this.reason}`
  }
}

export class NotConfigured extends Schema.TaggedError<NotConfigured, { readonly brand: unique symbol }>()(
  "NotConfigured",
  { feature: Text }
) {
  override get message() {
    return `${this.feature} is not set up in the Review Desk config`
  }
}

export class DeliveryFailed extends Schema.TaggedError<DeliveryFailed, { readonly brand: unique symbol }>()(
  "DeliveryFailed",
  { key: PrKey, reason: Text }
) {
  override get message() {
    return `Review Desk could not hand ${this.key} to an agent: ${this.reason}`
  }
}

export class RoundLimitReached extends Schema.TaggedError<RoundLimitReached, { readonly brand: unique symbol }>()(
  "RoundLimitReached",
  { key: PrKey, limit: Count }
) {
  override get message() {
    return `this thread on ${this.key} has used all ${this.limit} agent rounds; it is left for a person now, so do not reply`
  }
}

export class PostFailed extends Schema.TaggedError<PostFailed, { readonly brand: unique symbol }>()("PostFailed", {
  key: PrKey,
  reason: Text
}) {
  override get message() {
    return `could not post to ${this.key}: ${this.reason}`
  }
}

export class AgentUnreadable extends Schema.TaggedError<AgentUnreadable, { readonly brand: unique symbol }>()(
  "AgentUnreadable",
  { agent: Text, reason: Text }
) {
  override get message() {
    return `could not read ${this.agent}'s terminal: ${this.reason}`
  }
}

export const AgentStatus = Schema.Literals(["idle", "working", "blocked", "unknown"])

export const AgentRow = Schema.Struct({
  name: SessionName,
  machine: Schema.NullOr(Schema.String),
  host: Schema.String,
  pane: Schema.String,
  cwd: Schema.String,
  status: AgentStatus
})
export type AgentRow = typeof AgentRow.Type

export const AgentListing = Schema.Struct({ agents: Schema.Array(AgentRow), reached: Schema.Array(Schema.String) })
export type AgentListing = typeof AgentListing.Type

export const CommentOutcome = Schema.Literals(["open", "fixed", "answered", "dropped"])

export const CommentRequest = Schema.Struct({
  key: PrKey,
  body: Text,
  outcome: CommentOutcome,
  replyTo: Schema.NullOr(Text),
  path: Schema.NullOr(Text),
  line: Schema.NullOr(Schema.Int),
  close: Schema.optionalKey(Schema.Boolean)
})
export type CommentRequest = typeof CommentRequest.Type

export const IssueClaimRequest = Schema.Struct({
  repo: RepoSlug,
  from: Schema.NonEmptyArray(Login),
  machine: Schema.NullOr(Schema.String),
  pane: Schema.String
})
export type IssueClaimRequest = typeof IssueClaimRequest.Type

export const SummarySection = Schema.Literals(["reviewing", "mine", "mentions"])
export type SummarySection = typeof SummarySection.Type

export const SectionCount = Schema.Struct({ total: Count, needsYou: Count })
export type SectionCount = typeof SectionCount.Type

export const NeedItem = Schema.Struct({ key: PrKey, title: Text, url: Url, section: SummarySection, why: Text })
export type NeedItem = typeof NeedItem.Type

export const Summary = Schema.Struct({
  needsYou: Count,
  reviewing: SectionCount,
  mine: SectionCount,
  mentions: SectionCount,
  agents: Schema.Struct({ working: Count, talking: Count }),
  top: Schema.Array(NeedItem),
  health: Health,
  routing: Routing
})
export type Summary = typeof Summary.Type

export const TriageReport = Schema.Struct({
  key: PrKey,
  verdict: Verdict,
  reason: Text,
  settled: Schema.Array(Settled)
})
export type TriageReport = typeof TriageReport.Type

export const DeskRpcs = RpcGroup.make(
  Rpc.make("WatchBoard", { success: Board, stream: true }),
  Rpc.make("OpenInSidediff", {
    payload: { key: PrKey },
    error: Schema.Union([UnknownPull, SidediffFailed, NotConfigured])
  }),
  Rpc.make("ReportTriage", { payload: TriageReport, error: UnknownPull }),
  Rpc.make("WatchSummary", { success: Summary, stream: true }),
  Rpc.make("PostComment", {
    payload: CommentRequest,
    success: Schema.Struct({ url: Url }),
    error: Schema.Union([UnknownPull, RoundLimitReached, PostFailed])
  }),
  Rpc.make("Claim", {
    payload: { key: PrKey, session: Schema.NullOr(SessionName), role: Schema.optionalKey(Role) },
    error: Schema.Union([UnknownPull, DeliveryFailed])
  }),
  Rpc.make("ClaimIssues", {
    payload: IssueClaimRequest,
    success: Schema.Struct({ forges: Schema.Array(Forge) }),
    error: NotConfigured
  }),
  Rpc.make("MarkSeen", { payload: { key: PrKey }, error: UnknownPull }),
  Rpc.make("ReleaseIssues", {
    payload: { repo: RepoSlug, machine: Schema.NullOr(Schema.String), pane: Schema.String },
    success: Schema.Struct({ released: Count })
  }),
  Rpc.make("ListAgents", { success: AgentListing }),
  Rpc.make("ReadAgent", {
    payload: { agent: Schema.String, lines: Schema.Int },
    success: Schema.Struct({ text: Schema.String }),
    error: AgentUnreadable
  })
)
