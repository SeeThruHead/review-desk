import { Option, Schema } from "effect"

export const GraphqlErrors = Schema.Struct({
  errors: Schema.Array(Schema.Struct({ type: Schema.optionalKey(Schema.String), message: Schema.String }))
})

export type GraphqlFailure = { readonly rateLimited: boolean; readonly message: string }

const decodeErrors = Schema.decodeUnknownOption(GraphqlErrors)

const describe = (errors: (typeof GraphqlErrors.Type)["errors"]): GraphqlFailure => ({
  rateLimited: errors.some((error) => error.type === "RATE_LIMITED"),
  message: errors
    .map((error) => (error.type === undefined ? error.message : `${error.type}: ${error.message}`))
    .join("; ")
})

export const graphqlFailure = (body: unknown): Option.Option<GraphqlFailure> =>
  decodeErrors(body).pipe(
    Option.filter(({ errors }) => errors.length > 0),
    Option.map(({ errors }) => describe(errors))
  )

export const outOfBudget = (status: number, remaining: Option.Option<string>): boolean =>
  status === 403 && Option.contains(remaining, "0")

export const resetAt = (header: Option.Option<string>, nowMillis: number): number =>
  Option.match(Option.filter(Option.map(header, Number), Number.isFinite), {
    onNone: () => nowMillis + 15 * 60 * 1000,
    onSome: (seconds) => seconds * 1000
  })

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
