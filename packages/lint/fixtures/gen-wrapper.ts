import { Effect } from "effect"
export const g = (n: number) => Effect.gen(function* () {
  yield* Effect.void
  return n
})
