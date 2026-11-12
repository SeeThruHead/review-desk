import type { Health } from "@review-desk/contract/Board.ts"
import { IsoTime, Text } from "@review-desk/contract/Ids.ts"
import { DateTime } from "effect"

export type Failure = { readonly message: string; readonly paused: boolean; readonly until: string | null }

export const starting: Health = { state: "live", reason: null, lastGood: null, until: null }

export const healthAfter = (failures: ReadonlyArray<Failure>, before: Health, now: IsoTime): Health => {
  const paused = failures.find((failure) => failure.paused)
  if (paused !== undefined)
    return {
      state: "paused",
      reason: Text.make("GitHub's rate limit for this account is spent"),
      lastGood: before.lastGood,
      until: paused.until === null ? null : IsoTime.make(paused.until)
    }
  const first = failures[0]
  if (first !== undefined)
    return { state: "stale", reason: Text.make(first.message), lastGood: before.lastGood, until: null }

  return { state: "live", reason: null, lastGood: now, until: null }
}

const millisOf = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

export const overdue = (health: Health, nowMillis: number, pollSeconds: number): Health => {
  if (health.state !== "live" || health.lastGood === null) return health
  if (nowMillis - millisOf(health.lastGood) <= pollSeconds * 3000) return health

  return { ...health, state: "stale", reason: Text.make("No poll has finished for three poll intervals") }
}

export const crashed = (before: Health): Health => ({
  state: "stale",
  reason: Text.make("The last poll failed; see the desk's log"),
  lastGood: before.lastGood,
  until: null
})
