import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

export const PullSummary = Schema.Struct({
  repo: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  comments: Schema.Number
})
export type PullSummary = typeof PullSummary.Type

export const Snapshot = Schema.Struct({
  polls: Schema.Number,
  pulls: Schema.Array(PullSummary)
})
export type Snapshot = typeof Snapshot.Type

export const DeskRpcs = RpcGroup.make(Rpc.make("Watch", { success: Snapshot, stream: true }))
