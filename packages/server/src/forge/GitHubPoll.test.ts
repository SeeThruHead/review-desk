import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import {
  changedIds,
  chunksOf,
  graphqlFailure,
  listDue,
  outOfBudget,
  paceOf,
  resetAt,
  stampOf,
  uniqueById
} from "./GitHubPoll.ts"

const brief = (id: string, updatedAt: string, checks: string | null = null) => ({ id, updatedAt, checks })

describe("reading a GitHub GraphQL answer that failed", () => {
  it("names a rate limit as one, with GitHub's own message", () => {
    expect(
      graphqlFailure({ errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded for user ID 1." }] })
    ).toEqual(Option.some({ rateLimited: true, message: "RATE_LIMITED: API rate limit exceeded for user ID 1." }))
  })

  it("joins other errors into one message and does not call them a rate limit", () => {
    expect(
      graphqlFailure({ errors: [{ message: "Something went wrong" }, { type: "NOT_FOUND", message: "x" }] })
    ).toEqual(Option.some({ rateLimited: false, message: "Something went wrong; NOT_FOUND: x" }))
  })

  it("sees no failure in an answer with data, or with an empty error list", () => {
    expect(graphqlFailure({ data: { search: {} } })).toEqual(Option.none())
    expect(graphqlFailure({ errors: [] })).toEqual(Option.none())
  })

  it("treats a 403 with no requests left as a spent budget", () => {
    expect(outOfBudget(403, Option.some("0"))).toBe(true)
    expect(outOfBudget(403, Option.some("12"))).toBe(false)
    expect(outOfBudget(500, Option.some("0"))).toBe(false)
  })

  it("waits until GitHub's reset time, or a quarter of an hour when it gives none", () => {
    expect(resetAt(Option.some("1794409412"), 0)).toBe(1794409412000)
    expect(resetAt(Option.none(), 1000)).toBe(1000 + 15 * 60 * 1000)
    expect(resetAt(Option.some("soon"), 1000)).toBe(1000 + 15 * 60 * 1000)
  })
})

describe("fetching only the pull requests that changed", () => {
  it("asks again for a pull request when it was updated or its checks changed, and for one never seen", () => {
    const cache = new Map([
      ["a", { stamp: stampOf(brief("a", "t1")), node: "A" }],
      ["b", { stamp: stampOf(brief("b", "t1", "PENDING")), node: "B" }],
      ["c", { stamp: stampOf(brief("c", "t1")), node: "C" }]
    ])

    expect(
      changedIds([brief("a", "t1"), brief("b", "t1", "FAILURE"), brief("c", "t2"), brief("d", "t1")], cache)
    ).toEqual(["b", "c", "d"])
  })

  it("keeps the first of each pull request found by several searches", () => {
    expect(uniqueById([brief("a", "t1"), brief("b", "t1"), brief("a", "t2")])).toEqual([
      brief("a", "t1"),
      brief("b", "t1")
    ])
  })

  it("splits ids into batches GitHub accepts", () => {
    expect(chunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunksOf([], 50)).toEqual([])
  })
})

const rate = (remaining: number) => ({ limit: 5000, remaining, resetAt: "2026-11-05T20:00:00Z" })

describe("how fast to read GitHub as the account's budget runs down", () => {
  it("reads at the usual pace with a fifth or more left, or when it does not know", () => {
    expect(paceOf(rate(1000))).toBe("go")
    expect(paceOf(null)).toBe("go")
    expect(paceOf({ ...rate(0), limit: 0 })).toBe("go")
  })

  it("slows below a fifth and stops below a twentieth", () => {
    expect(paceOf(rate(999))).toBe("slow")
    expect(paceOf(rate(250))).toBe("slow")
    expect(paceOf(rate(249))).toBe("stop")
  })

  it("reads a repository half as often while slowed", () => {
    expect(listDue("go", 0, 1000, 60_000)).toBe(true)
    expect(listDue("slow", undefined, 1000, 60_000)).toBe(true)
    expect(listDue("slow", 0, 60_000, 60_000)).toBe(false)
    expect(listDue("slow", 0, 90_000, 60_000)).toBe(true)
  })
})
