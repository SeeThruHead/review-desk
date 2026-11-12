import { describe, expect, it } from "@effect/vitest"
import { RepoSlug } from "@review-desk/contract/Ids.ts"
import { DETAIL_QUERY, LIST_QUERY, MENTION_QUERY, factsOf } from "./GitHub.ts"

const author = (login: string, kind = "User") => ({ login, kind })

const node: Parameters<typeof factsOf>[1] = {
  number: 7,
  title: "Cache the plan lookups",
  body: "",
  url: "https://github.com/acme/api/pull/7",
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  createdAt: "2026-11-05T09:00:00Z",
  updatedAt: "2026-11-05T10:00:00Z",
  reviewDecision: "APPROVED",
  mergeQueueEntry: { state: "QUEUED", position: 2 },
  headRefName: "cache",
  baseRefName: "main",
  headRefOid: "abc",
  author: author("dana"),
  labels: { nodes: [] },
  reviewRequests: { nodes: [] },
  files: null,
  latest: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  reviews: {
    nodes: [
      {
        databaseId: 1,
        state: "APPROVED",
        body: "",
        submittedAt: null,
        url: "https://github.com/acme/api/pull/7#r1",
        author: author("lee")
      }
    ]
  },
  comments: {
    nodes: [
      {
        databaseId: 2,
        body: "Consider a name",
        createdAt: "2026-11-05T09:30:00Z",
        url: "https://github.com/acme/api/pull/7#c2",
        author: author("coderabbitai", "Bot")
      },
      {
        databaseId: 3,
        body: "Lint passed",
        createdAt: "2026-11-05T09:31:00Z",
        url: "https://github.com/acme/api/pull/7#c3",
        author: { login: "linter[bot]" }
      }
    ]
  },
  reviewThreads: { nodes: [] }
}

describe("reading a GitHub pull request", () => {
  it("keeps the review decision, the merge queue entry and when it was opened", () => {
    const facts = factsOf(RepoSlug.make("acme/api"), node)

    expect(facts.review).toBe("approved")
    expect(facts.queue).toEqual({ state: "queued", position: 2 })
    expect(facts.createdAt).toBe("2026-11-05T09:00:00Z")
    expect(facts.reviews[0]?.bot).toBeUndefined()
  })

  it("marks bot accounts, whether GitHub names them as bots or by their login", () => {
    const facts = factsOf(RepoSlug.make("acme/api"), node)

    expect(facts.comments.map((comment) => [comment.author, comment.bot])).toEqual([
      ["coderabbitai", true],
      ["linter", true]
    ])
  })

  it("reads no decision and no queue entry when GitHub gives none", () => {
    const { createdAt: _, ...unopened } = node
    const facts = factsOf(RepoSlug.make("acme/api"), { ...unopened, reviewDecision: null, mergeQueueEntry: null })

    expect([facts.review, facts.queue, facts.createdAt]).toEqual([null, null, undefined])
  })

  it("asks for mentioned issues and the rate budget in the same list call", () => {
    expect(LIST_QUERY).toContain("mentioned: search(query: $mentioned, type: ISSUE, first: 20)")
    expect(LIST_QUERY).toContain("rateLimit { limit remaining resetAt }")
  })

  it("reads the review decision, the merge queue and who is a bot in the detail, and mentioned issues by id", () => {
    expect(DETAIL_QUERY).toContain("reviewDecision mergeQueueEntry { state position }")
    expect(DETAIL_QUERY).toContain("author { login kind: __typename }")
    expect(MENTION_QUERY).toContain("nodes(ids: $ids)")
    expect(MENTION_QUERY).toContain("comments(last: 30)")
  })
})
