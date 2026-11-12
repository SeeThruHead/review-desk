import type { Budget } from "@review-desk/contract/Board.ts"
import type { RepoSlug, Text } from "@review-desk/contract/Ids.ts"
import type { Run } from "@review-desk/domain/Branches.ts"
import type { IssueFacts, PullFacts } from "@review-desk/domain/Facts.ts"
import { Context, type Effect, Schema } from "effect"

export class ForgeError extends Schema.TaggedError<ForgeError, { readonly brand: unique symbol }>()("ForgeError", {
  forge: Schema.String,
  reason: Schema.String,
  paused: Schema.optionalKey(Schema.Boolean),
  until: Schema.optionalKey(Schema.String)
}) {
  override get message() {
    return `${this.forge} did not answer as expected: ${this.reason}`
  }
}

export type Post = {
  readonly body: string
  readonly replyTo: string | null
  readonly path: string | null
  readonly line: number | null
}

export type ForgeClient = {
  readonly pulls: (repo: RepoSlug) => Effect.Effect<ReadonlyArray<PullFacts>, ForgeError>
  readonly post: (pull: PullFacts, post: Post) => Effect.Effect<string, ForgeError>
  readonly issues: (repo: RepoSlug) => Effect.Effect<ReadonlyArray<IssueFacts>, ForgeError>
  readonly mentions: (repo: RepoSlug) => Effect.Effect<ReadonlyArray<IssueFacts>, ForgeError>
  readonly budget: Effect.Effect<Budget | null>
  readonly commentOnIssue: (repo: RepoSlug, number: number, body: string) => Effect.Effect<string, ForgeError>
  readonly closeIssue: (repo: RepoSlug, number: number) => Effect.Effect<void, ForgeError>
}

export type BranchRuns = {
  readonly runs: (repo: RepoSlug, branch: string) => Effect.Effect<ReadonlyArray<Run>, ForgeError>
  readonly failedJobs: (repo: RepoSlug, run: number) => Effect.Effect<ReadonlyArray<Text>, ForgeError>
  readonly ownedRepos: (logins: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<RepoSlug>, ForgeError>
}

export class Forges extends Context.Service<
  Forges,
  {
    readonly github: ForgeClient | null
    readonly gitea: (ForgeClient & BranchRuns) | null
    readonly giteaHost: string | null
  }
>()("review-desk/server/Forges") {}
