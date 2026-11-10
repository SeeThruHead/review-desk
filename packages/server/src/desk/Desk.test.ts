import { describe, expect, it } from "@effect/vitest"
import { fromAuthor, fromPerson, fromReviewer, pull, dana, thread } from "@review-desk/domain/Facts.testing.ts"
import { roundFor, threadReplyTarget } from "./Desk.ts"

describe("where a reply goes", () => {
  const facts = pull(1, {
    comments: [fromPerson(dana, "Top-level summary")],
    threads: [thread("a.ts", [fromReviewer(1, "Missing await"), fromAuthor(1, "Added")])]
  })
  const inline = facts.threads[0]?.comments[0]?.id ?? null
  const topLevel = facts.comments[0]?.id ?? null

  it("answers an inline comment in its thread, and a top-level comment with a new top-level comment", () => {
    expect(threadReplyTarget(facts, inline)).toBe(inline)
    expect(threadReplyTarget(facts, topLevel)).toBeNull()
    expect(threadReplyTarget(facts, null)).toBeNull()
    expect(threadReplyTarget({ ...facts, forge: "gitea" }, inline)).toBeNull()
  })

  it("numbers a reviewer's reply as the next round and an author's reply as the round it answers", () => {
    expect(roundFor(facts.threads[0], "reviewer")).toBe(2)
    expect(roundFor(facts.threads[0], "author")).toBe(1)
    expect(roundFor(undefined, "reviewer")).toBe(1)
    expect(roundFor(undefined, "author")).toBe(1)
  })
})
