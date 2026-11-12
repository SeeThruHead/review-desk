import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import {
  type Answer,
  backoffMillis,
  changedIds,
  chunksOf,
  graphqlFailure,
  listDue,
  paceOf,
  readDue,
  refusalOf,
  resumeAt,
  stampOf,
  uniqueById,
  verdictOf
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

  it("calls any RATE_LIMIT error type a rate limit", () => {
    expect(graphqlFailure({ errors: [{ type: "RATE_LIMIT", message: "already exceeded" }] })).toEqual(
      Option.some({ rateLimited: true, message: "RATE_LIMIT: already exceeded" })
    )
  })
})

const answer = (fields: Partial<Answer>): Answer => ({
  status: 200,
  remaining: Option.none(),
  retryAfter: Option.none(),
  reset: Option.none(),
  body: { data: { ok: true } },
  ...fields
})

const now = 1_000_000

describe("deciding what a GitHub answer means", () => {
  it("reads the data of a good answer", () => {
    expect(verdictOf(answer({}), now)).toEqual({ _tag: "Read", data: { ok: true } })
  })

  it("waits until the reset when the hour's budget is spent", () => {
    const spent = answer({ status: 403, remaining: Option.some("0"), reset: Option.some("2000"), body: "" })

    expect(verdictOf(spent, now)).toEqual({
      _tag: "Throttled",
      reason: "GitHub's rate limit for this account is spent",
      until: 2_000_000
    })
  })

  it("honours retry-after on a secondary limit, before any reset time", () => {
    const secondary = answer({
      status: 403,
      remaining: Option.some("4400"),
      retryAfter: Option.some("60"),
      reset: Option.some("9999"),
      body: { message: "You have exceeded a secondary rate limit." }
    })

    expect(verdictOf(secondary, now)).toEqual({
      _tag: "Throttled",
      reason: "GitHub's secondary rate limit refused the read",
      until: now + 60_000
    })
  })

  it("counts a 429, and a 403 that only names a rate limit, as throttling with no time given", () => {
    expect(verdictOf(answer({ status: 429, body: "slow down" }), now)).toMatchObject({ _tag: "Throttled", until: null })
    expect(verdictOf(answer({ status: 403, body: { message: "API rate limit exceeded" } }), now)).toMatchObject({
      _tag: "Throttled",
      until: null
    })
  })

  it("fails a 403 that has nothing to do with rate limits, and any other bad status", () => {
    expect(verdictOf(answer({ status: 403, body: { message: "Resource not accessible" } }), now)).toEqual({
      _tag: "Failed",
      reason: "HTTP 403"
    })
    expect(verdictOf(answer({ status: 502, body: "" }), now)).toEqual({ _tag: "Failed", reason: "HTTP 502" })
    expect(verdictOf(answer({ status: 403, body: undefined }), now)).toEqual({ _tag: "Failed", reason: "HTTP 403" })
  })

  it("throttles on a rate limit error inside a 200, by its type or by its words", () => {
    const typed = answer({ body: { errors: [{ type: "RATE_LIMIT", message: "already exceeded" }] } })
    const worded = answer({ body: { errors: [{ message: "API rate limit already exceeded for user ID 1" }] } })

    expect(verdictOf(typed, now)).toMatchObject({ _tag: "Throttled" })
    expect(verdictOf(worded, now)).toMatchObject({ _tag: "Throttled" })
  })

  it("fails on other GraphQL errors", () => {
    expect(verdictOf(answer({ body: { errors: [{ message: "Something went wrong" }] } }), now)).toEqual({
      _tag: "Failed",
      reason: "Something went wrong"
    })
  })

  it("backs off on an answer without data instead of reading it again next poll", () => {
    expect(verdictOf(answer({ body: {} }), now)).toEqual({
      _tag: "Throttled",
      reason: "GitHub answered without data",
      until: null
    })
    expect(verdictOf(answer({ body: { data: null } }), now)).toMatchObject({ _tag: "Throttled" })
    expect(verdictOf(answer({ body: "<html>" }), now)).toMatchObject({ _tag: "Throttled" })
  })

  it("ignores a retry-after it cannot read", () => {
    expect(verdictOf(answer({ status: 429, retryAfter: Option.some("soon"), body: "" }), now)).toMatchObject({
      until: null
    })
  })

  it("names a refusal only for a rate limit, so a change check can tell it from a normal answer", () => {
    expect(refusalOf(answer({ status: 304, body: "" }), now)).toBeNull()
    expect(refusalOf(answer({ status: 429, body: "" }), now)).toEqual({
      reason: "GitHub's rate limit for this account is spent",
      until: null
    })
  })
})

describe("backing off after GitHub refuses", () => {
  it("doubles the wait from a minute with each refusal in a row, up to an hour", () => {
    expect([1, 2, 3, 4, 7, 20].map(backoffMillis)).toEqual([60_000, 120_000, 240_000, 480_000, 3_600_000, 3_600_000])
    expect(backoffMillis(0)).toBe(60_000)
  })

  it("waits for GitHub's own time when it is later than the backoff, and the backoff otherwise", () => {
    expect(resumeAt(now + 600_000, 1, now)).toBe(now + 600_000)
    expect(resumeAt(now + 10_000, 1, now)).toBe(now + 60_000)
    expect(resumeAt(null, 2, now)).toBe(now + 120_000)
  })
})

describe("reading a repository only when it changed", () => {
  const reading = { generation: 3, at: now, pending: false }
  const due = (fields: Partial<Parameters<typeof readDue>[0]>) =>
    readDue({ generation: 3, last: reading, nowMillis: now + 1000, safetyMillis: 900_000, ...fields })

  it("reads a repository it has never read", () => {
    expect(due({ last: undefined })).toBe(true)
  })

  it("skips the read while the change check says nothing changed", () => {
    expect(due({})).toBe(false)
  })

  it("reads when the change check saw a change", () => {
    expect(due({ generation: 4 })).toBe(true)
  })

  it("keeps reading while checks are pending, since finishing CI does not change the repository", () => {
    expect(due({ last: { ...reading, pending: true } })).toBe(true)
  })

  it("reads again after the safety interval even with no change seen", () => {
    expect(due({ nowMillis: now + 900_000 })).toBe(true)
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
