import { Checks, MergeQueue, ReviewDecision } from "@review-desk/contract/Board.ts"
import { Forge, IsoTime, Login, PrKey, PrNumber, RepoSlug, Text, Url } from "@review-desk/contract/Ids.ts"
import { Schema } from "effect"

export const Side = Schema.Literals(["reviewer", "author"])
export type Side = typeof Side.Type

export const ForgeId = Schema.String.pipe(Schema.brand("ForgeId"))
export type ForgeId = typeof ForgeId.Type

export const Branch = Schema.String.pipe(Schema.brand("Branch"))
export type Branch = typeof Branch.Type

export const Comment = Schema.Struct({
  id: ForgeId,
  author: Login,
  body: Text,
  at: IsoTime,
  url: Url,
  bot: Schema.optionalKey(Schema.Boolean)
})
export type Comment = typeof Comment.Type

export const Thread = Schema.Struct({
  id: ForgeId,
  path: Text,
  line: Schema.NullOr(Schema.Int),
  resolved: Schema.Boolean,
  changedSince: Schema.optionalKey(Schema.Boolean),
  comments: Schema.Array(Comment)
})
export type Thread = typeof Thread.Type

export const ReviewState = Schema.Literals(["approved", "changes_requested", "commented", "dismissed", "pending"])

export const Review = Schema.Struct({
  id: ForgeId,
  author: Login,
  state: ReviewState,
  body: Text,
  at: IsoTime,
  url: Url,
  bot: Schema.optionalKey(Schema.Boolean)
})
export type Review = typeof Review.Type

export const PullState = Schema.Literals(["open", "merged", "closed"])

export const Mergeable = Schema.Literals(["yes", "no", "unknown"])

export const PullFacts = Schema.Struct({
  key: PrKey,
  forge: Forge,
  repo: RepoSlug,
  number: PrNumber,
  title: Text,
  body: Text,
  url: Url,
  author: Login,
  head: Branch,
  headSha: Text,
  base: Branch,
  draft: Schema.Boolean,
  state: PullState,
  labels: Schema.Array(Text),
  requested: Schema.Array(Login),
  files: Schema.Array(Text),
  checks: Checks,
  mergeable: Mergeable,
  review: Schema.NullOr(ReviewDecision),
  queue: Schema.NullOr(MergeQueue),
  reviews: Schema.Array(Review),
  threads: Schema.Array(Thread),
  comments: Schema.Array(Comment),
  createdAt: Schema.optionalKey(IsoTime),
  updatedAt: IsoTime
})
export type PullFacts = typeof PullFacts.Type

export const IssueFacts = Schema.Struct({
  forge: Forge,
  repo: RepoSlug,
  number: PrNumber,
  id: ForgeId,
  title: Text,
  body: Text,
  url: Url,
  author: Login,
  createdAt: IsoTime,
  comments: Schema.Array(Comment),
  updatedAt: Schema.optionalKey(IsoTime)
})
export type IssueFacts = typeof IssueFacts.Type
