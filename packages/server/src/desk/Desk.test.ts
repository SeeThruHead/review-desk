import { describe, expect, it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { fromAuthor, fromPerson, fromReviewer, pull, dana, thread } from "@review-desk/domain/Facts.testing.ts"
import { findOrPoll, roundFor, threadReplyTarget } from "./Desk.ts"

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

const polling = Effect.fnUntraced(function* (afterPoll: string | undefined) {
  const seen = yield* Ref.make<string | undefined>(undefined)
  const polls = yield* Ref.make(0)
  const poll = Ref.update(polls, (n) => n + 1).pipe(Effect.andThen(Ref.set(seen, afterPoll)))
  return { lookup: findOrPoll(Ref.get(seen), poll, () => "unknown"), polls }
})

describe("looking up a pull request the desk has not polled yet", () => {
  it.effect("polls once and finds a pull request that was just opened", () =>
    Effect.gen(function* () {
      const { lookup, polls } = yield* polling("github:org/repo#1")
      const found = yield* lookup
      const count = yield* Ref.get(polls)
      expect(found).toBe("github:org/repo#1")
      expect(count).toBe(1)
    })
  )

  it.effect("still refuses a pull request the poll does not find", () =>
    Effect.gen(function* () {
      const { lookup, polls } = yield* polling(undefined)
      const refused = yield* Effect.flip(lookup)
      const count = yield* Ref.get(polls)
      expect(refused).toBe("unknown")
      expect(count).toBe(1)
    })
  )

  it.effect("does not poll for a pull request it already knows", () =>
    Effect.gen(function* () {
      const polls = yield* Ref.make(0)
      const found = yield* findOrPoll(
        Effect.succeed("known"),
        Ref.update(polls, (n) => n + 1),
        () => "unknown"
      )
      const count = yield* Ref.get(polls)
      expect(found).toBe("known")
      expect(count).toBe(0)
    })
  )
})
