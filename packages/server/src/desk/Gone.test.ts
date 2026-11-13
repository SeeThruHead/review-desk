import { describe, expect, it } from "@effect/vitest"
import { shippedHostNames } from "../agents/Address.ts"
import { type Holder, type Roster, absences, placeOf, sightingOf, unknownRoster } from "./Gone.ts"

const roster = (fields: Partial<Roster>): Roster => ({
  agents: [{ name: "auth", machine: null, pane: "w1:p1" }],
  reached: [placeOf(null, "herdr"), placeOf("STHDEV", "herdr")],
  complete: true,
  prefixes: shippedHostNames,
  ...fields
})

const watcher: Holder = { _tag: "Pane", key: "gitea:sth/tether@STHDEV/w9:p1", machine: "STHDEV", pane: "w9:p1" }
const reviewer: Holder = { _tag: "Session", key: "github:acme/api#7", session: "auth" }

const grace = 30 * 60 * 1000
const now = 10_000_000

describe("whether a claim's agent is still there", () => {
  it("sees an agent by its name or its pane", () => {
    expect(sightingOf(reviewer, roster({}))).toBe("present")
    expect(sightingOf({ ...reviewer, session: "w1:p1" }, roster({}))).toBe("present")
    expect(sightingOf({ ...watcher, machine: null, pane: "w1:p1" }, roster({}))).toBe("present")
  })

  it("calls a pane gone only when its machine's terminal host answered without it", () => {
    expect(sightingOf(watcher, roster({}))).toBe("gone")
    expect(sightingOf(watcher, roster({ reached: [placeOf(null, "herdr")] }))).toBe("unknown")
    expect(sightingOf({ ...watcher, machine: null, pane: "hc:t3" }, roster({}))).toBe("unknown")
    expect(sightingOf({ ...watcher, machine: null, pane: "hc:t3" }, roster({ reached: [placeOf(null, "hc")] }))).toBe(
      "gone"
    )
  })

  it("calls a named agent gone only when every machine answered", () => {
    expect(sightingOf({ ...reviewer, session: "ui-kit" }, roster({}))).toBe("gone")
    expect(sightingOf({ ...reviewer, session: "ui-kit" }, roster({ complete: false }))).toBe("unknown")
  })

  it("knows nothing when the agents could not be listed at all", () => {
    expect(sightingOf(watcher, unknownRoster)).toBe("unknown")
    expect(sightingOf(reviewer, unknownRoster)).toBe("unknown")
  })
})

describe("releasing a claim once its agent has been gone past the grace period", () => {
  it("starts counting when the agent is first missed, and releases nothing yet", () => {
    expect(absences([watcher], roster({}), new Map(), now, grace)).toEqual({
      missing: new Map([[watcher.key, now]]),
      expired: []
    })
  })

  it("keeps counting from the first miss while the agent stays gone", () => {
    const before = new Map([[watcher.key, now - 60_000]])

    expect(absences([watcher], roster({}), before, now, grace).missing).toEqual(before)
  })

  it("releases the claim when the agent has been gone for the whole grace period", () => {
    const before = new Map([[watcher.key, now - grace]])

    expect(absences([watcher], roster({}), before, now, grace)).toEqual({ missing: new Map(), expired: [watcher] })
  })

  it("forgets the miss when the agent comes back", () => {
    const before = new Map([[reviewer.key, now - grace]])

    expect(absences([reviewer], roster({}), before, now, grace)).toEqual({ missing: new Map(), expired: [] })
  })

  it("neither releases nor starts counting while it cannot tell, but keeps an earlier miss", () => {
    const before = new Map([[watcher.key, now - grace]])

    expect(absences([watcher], unknownRoster, before, now, grace)).toEqual({ missing: before, expired: [] })
    expect(absences([watcher], unknownRoster, new Map(), now, grace)).toEqual({ missing: new Map(), expired: [] })
  })
})
