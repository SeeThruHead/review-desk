import { Option, Predicate, Schema } from "effect"

export const GraphqlErrors = Schema.Struct({
  errors: Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String), message: Schema.String }))
})

export type GraphqlFailure = { readonly rateLimited: boolean; readonly message: string }

const decodeErrors = Schema.decodeUnknownOption(GraphqlErrors)

const describe = (errors: (typeof GraphqlErrors.Type)["errors"]): GraphqlFailure => ({
  rateLimited: errors.some((error) => error.type?.startsWith("RATE_LIMIT") === true),
  message: errors
    .map((error) => (error.type === undefined ? error.message : `${error.type}: ${error.message}`))
    .join("; ")
})

export const graphqlFailure = (body: unknown): Option.Option<GraphqlFailure> =>
  decodeErrors(body).pipe(
    Option.filter(({ errors }) => errors.length > 0),
    Option.map(({ errors }) => describe(errors))
  )

export type Brief = {
  readonly id: string
  readonly updatedAt: string
  readonly checks: string | null
}

export const stampOf = (brief: Brief): string => `${brief.updatedAt}|${brief.checks ?? "none"}`

export type Cached<A> = { readonly stamp: string; readonly node: A }

export const changedIds = <A>(
  briefs: ReadonlyArray<Brief>,
  cache: ReadonlyMap<string, Cached<A>>
): ReadonlyArray<string> =>
  briefs.filter((brief) => cache.get(brief.id)?.stamp !== stampOf(brief)).map((brief) => brief.id)

export const uniqueById = <A extends { readonly id: string }>(found: ReadonlyArray<A>): ReadonlyArray<A> =>
  found.filter((item, index) => found.findIndex((other) => other.id === item.id) === index)

export const chunksOf = <A>(items: ReadonlyArray<A>, size: number): ReadonlyArray<ReadonlyArray<A>> =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size))

export type RateLimit = { readonly limit: number; readonly remaining: number; readonly resetAt: string }

export type Pace = "go" | "slow" | "stop"

export const paceOf = (rate: RateLimit | null): Pace => {
  if (rate === null || rate.limit <= 0) return "go"
  const share = rate.remaining / rate.limit
  if (share < 0.05) return "stop"

  return share < 0.2 ? "slow" : "go"
}

export const listDue = (pace: Pace, lastMillis: number | undefined, nowMillis: number, intervalMillis: number) => {
  if (pace !== "slow" || lastMillis === undefined) return true

  return nowMillis - lastMillis >= intervalMillis * 1.5
}

export type Answer = {
  readonly status: number
  readonly remaining: Option.Option<string>
  readonly retryAfter: Option.Option<string>
  readonly reset: Option.Option<string>
  readonly body: unknown
}

export type Throttle = { readonly reason: string; readonly until: number | null }

export type Verdict =
  | { readonly _tag: "Read"; readonly data: unknown }
  | ({ readonly _tag: "Throttled" } & Throttle)
  | { readonly _tag: "Failed"; readonly reason: string }

const SPENT = "GitHub's rate limit for this account is spent"
const SECONDARY = "GitHub's secondary rate limit refused the read"
const EMPTY = "GitHub answered without data"

const secondsFrom = (header: Option.Option<string>): Option.Option<number> =>
  Option.filter(Option.map(header, Number), (seconds) => Number.isFinite(seconds) && seconds >= 0)

const untilOf = (answer: Answer, nowMillis: number): number | null => {
  const retry = secondsFrom(answer.retryAfter)
  if (Option.isSome(retry)) return nowMillis + retry.value * 1000
  if (!Option.contains(answer.remaining, "0")) return null

  return Option.getOrNull(Option.map(secondsFrom(answer.reset), (seconds) => seconds * 1000))
}

const encodeJson = Schema.encodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const textOf = (body: unknown): string =>
  Predicate.isString(body) ? body : Option.getOrElse(encodeJson(body), () => "")

const mentionsSecondary = (body: unknown): boolean => /secondary rate limit|abuse/i.test(textOf(body))

const mentionsRateLimit = (body: unknown): boolean => /rate.?limit/i.test(textOf(body))

const throttleOf = (answer: Answer, nowMillis: number): Throttle => ({
  reason: mentionsSecondary(answer.body) ? SECONDARY : SPENT,
  until: untilOf(answer, nowMillis)
})

const hasData = (body: unknown): body is { readonly data: unknown } =>
  Predicate.hasProperty(body, "data") && body.data !== null

const refusedForRate = (answer: Answer): boolean => {
  if (answer.status === 429) return true
  if (answer.status !== 403) return false

  return Option.contains(answer.remaining, "0") || Option.isSome(answer.retryAfter) || mentionsRateLimit(answer.body)
}

export const refusalOf = (answer: Answer, nowMillis: number): Throttle | null =>
  refusedForRate(answer) ? throttleOf(answer, nowMillis) : null

const aboutRate = (failure: GraphqlFailure): boolean => failure.rateLimited || mentionsRateLimit(failure.message)

export const verdictOf = (answer: Answer, nowMillis: number): Verdict => {
  if (refusedForRate(answer)) return { _tag: "Throttled", ...throttleOf(answer, nowMillis) }
  if (answer.status >= 300) return { _tag: "Failed", reason: `HTTP ${answer.status}` }
  const failure = graphqlFailure(answer.body)
  if (Option.exists(failure, aboutRate)) return { _tag: "Throttled", ...throttleOf(answer, nowMillis) }
  if (Option.isSome(failure)) return { _tag: "Failed", reason: failure.value.message }
  if (!hasData(answer.body)) return { _tag: "Throttled", reason: EMPTY, until: untilOf(answer, nowMillis) }

  return { _tag: "Read", data: answer.body.data }
}

const minute = 60 * 1000

export const backoffMillis = (strikes: number): number => Math.min(60 * minute, minute * 2 ** Math.max(0, strikes - 1))

export const resumeAt = (until: number | null, strikes: number, nowMillis: number): number =>
  Math.max(until ?? 0, nowMillis + backoffMillis(strikes))

export type Reading = { readonly generation: number; readonly at: number; readonly pending: boolean }

export type ReadDue = {
  readonly generation: number
  readonly last: Reading | undefined
  readonly nowMillis: number
  readonly safetyMillis: number
}

export const readDue = ({ generation, last, nowMillis, safetyMillis }: ReadDue): boolean => {
  if (last === undefined) return true
  if (last.generation !== generation) return true
  if (last.pending) return true

  return nowMillis - last.at >= safetyMillis
}
