import { describe, expect, it } from "@effect/vitest"
import { threadsOf } from "./Gitea.ts"

type ReviewComment = Parameters<typeof threadsOf>[0][number]

const comment = (id: number, fields: Partial<ReviewComment> = {}): ReviewComment => ({
  id,
  body: "Leaks the token",
  path: "src/auth.ts",
  position: 12,
  created_at: "2026-11-05T09:40:00Z",
  html_url: `https://gitea.example/acme/api/pulls/7#c${id}`,
  user: { login: "dana" },
  ...fields
})

describe("reading a Gitea pull request's review threads", () => {
  it("marks a thread whose last comment was written on an older commit than the head", () => {
    expect(threadsOf([comment(1, { commit_id: "old" })], "new")[0]?.changedSince).toBe(true)
    expect(
      threadsOf([comment(1, { commit_id: "old" }), comment(2, { commit_id: "new" })], "new")[0]
    ).not.toHaveProperty("changedSince")
    expect(threadsOf([comment(1, { commit_id: null })], "new")[0]).not.toHaveProperty("changedSince")
    expect(threadsOf([comment(1)], "new")[0]).not.toHaveProperty("changedSince")
  })
})
