import { Schema } from "effect"

export const Login = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*(\[bot\])?$/)),
  Schema.brand("Login")
)
export type Login = typeof Login.Type

export const RepoSlug = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[^/\s]+\/[^/\s]+$/)),
  Schema.brand("RepoSlug")
)
export type RepoSlug = typeof RepoSlug.Type

export const PrNumber = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)), Schema.brand("PrNumber"))
export type PrNumber = typeof PrNumber.Type

export const PrKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^(github|gitea):[^/\s]+\/[^/\s#]+#\d+$/)),
  Schema.brand("PrKey")
)
export type PrKey = typeof PrKey.Type

export const Url = Schema.String.pipe(Schema.check(Schema.isPattern(/^https?:\/\//)), Schema.brand("Url"))
export type Url = typeof Url.Type

export const Text = Schema.String.pipe(Schema.brand("Text"))
export type Text = typeof Text.Type

export const SessionName = Schema.String.pipe(Schema.check(Schema.isMinLength(1)), Schema.brand("SessionName"))
export type SessionName = typeof SessionName.Type

export const IsoTime = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T/)),
  Schema.brand("IsoTime")
)
export type IsoTime = typeof IsoTime.Type

export const Count = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)), Schema.brand("Count"))
export type Count = typeof Count.Type

export const Forge = Schema.Literals(["github", "gitea"])
export type Forge = typeof Forge.Type

export const prKey = (forge: Forge, repo: RepoSlug, number: PrNumber): PrKey => PrKey.make(`${forge}:${repo}#${number}`)
