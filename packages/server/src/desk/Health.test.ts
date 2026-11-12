import { describe, expect, it } from "@effect/vitest"
import { IsoTime } from "@review-desk/contract/Ids.ts"
import { DateTime } from "effect"
import { crashed, healthAfter, overdue, starting } from "./Health.ts"

const now = IsoTime.make("2026-11-05T19:50:00Z")
const earlier = { ...starting, lastGood: IsoTime.make("2026-11-05T19:45:00Z") }
const millis = (iso: string) => DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

describe("whether the board's data is current", () => {
  it("is live, read now, after a poll with no failures", () => {
    expect(healthAfter([], earlier, now)).toEqual({ state: "live", reason: null, lastGood: now, until: null })
  })

  it("is paused until the reset when GitHub's rate limit stopped a read, keeping the last good time", () => {
    const failures = [
      { message: "gitea timed out", paused: false, until: null },
      { message: "rate limit", paused: true, until: "2026-11-05T20:12:00Z" }
    ]

    expect(healthAfter(failures, earlier, now)).toEqual({
      state: "paused",
      reason: "rate limit",
      lastGood: earlier.lastGood,
      until: "2026-11-05T20:12:00Z"
    })
    expect(healthAfter([{ message: "rate limit", paused: true, until: null }], earlier, now).until).toBeNull()
  })

  it("is stale with the first failure's reason when a read failed", () => {
    expect(healthAfter([{ message: "github did not answer", paused: false, until: null }], earlier, now)).toEqual({
      state: "stale",
      reason: "github did not answer",
      lastGood: earlier.lastGood,
      until: null
    })
  })

  it("turns stale when no poll has finished for three intervals", () => {
    const live = healthAfter([], earlier, now)

    expect(overdue(live, millis("2026-11-05T19:52:59Z"), 60)).toBe(live)
    expect(overdue(live, millis("2026-11-05T19:53:01Z"), 60).state).toBe("stale")
    expect(overdue(starting, millis("2026-11-05T23:00:00Z"), 60)).toBe(starting)
    expect(overdue(crashed(earlier), millis("2026-11-05T23:00:00Z"), 60).state).toBe("stale")
  })

  it("says a poll that crashed left the board stale", () => {
    expect(crashed(earlier)).toEqual({
      state: "stale",
      reason: "The last poll failed; see the desk's log",
      lastGood: earlier.lastGood,
      until: null
    })
  })
})
