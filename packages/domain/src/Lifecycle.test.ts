import { describe, expect, it } from "@effect/vitest"
import { PrKey, SessionName, Text } from "@review-desk/contract/Ids.ts"
import { lee, fromAuthor, fromPerson, fromReviewer, pull, review, dana, thread } from "./Facts.testing.ts"
import { type Context, answeredByCommit, cardOf, threadState } from "./Lifecycle.ts"

const desk = { logins: ["dana", "dana-gitea"], limit: 3, intakeLabel: "agent-review" }

const reviewing: Context = {
  role: "reviewer",
  trusted: true,
  claimed: false,
  triage: null,
  agent: null,
  relations: [],
  delivered: null
}

const authoring: Context = { ...reviewing, role: "author" }

const triaged: Context = { ...reviewing, claimed: true, triage: { verdict: "skim", reason: Text.make("Rename only") } }

describe("a review thread between two agents", () => {
  it("is waiting on the author after the reviewer comments, and on the reviewer after the author answers", () => {
    expect(threadState(thread("a.ts", [fromReviewer(1, "Missing await")]), 3)).toEqual({
      _tag: "Open",
      round: 1,
      waitingOn: "author"
    })
    expect(threadState(thread("a.ts", [fromReviewer(1, "Missing await"), fromAuthor(1, "Added it")]), 3)).toEqual({
      _tag: "Open",
      round: 1,
      waitingOn: "reviewer"
    })
  })

  it("settles when the reviewer accepts, when either side drops it, or when it is resolved", () => {
    const accepted = threadState(
      thread("a.ts", [fromReviewer(1, "Missing await"), fromAuthor(1, "Added it"), fromReviewer(2, "Thanks", "fixed")]),
      3
    )
    expect(accepted).toMatchObject({ _tag: "Settled", outcome: "fixed" })
    expect(
      threadState(thread("a.ts", [fromReviewer(1, "Rename"), fromAuthor(1, "Flag already set", "dropped")]), 3)
    ).toMatchObject({
      _tag: "Settled",
      outcome: "dropped"
    })
    expect(threadState(thread("a.ts", [fromReviewer(1, "Rename")], true), 3)).toMatchObject({
      _tag: "Settled",
      outcome: "fixed"
    })
    expect(
      threadState(thread("a.ts", [fromReviewer(1, "Why?"), fromAuthor(1, "Because", "answered")], true), 3)
    ).toMatchObject({
      outcome: "answered"
    })
    expect(
      threadState(thread("a.ts", [fromReviewer(1, "Why?"), fromPerson(lee, "Talked offline")], true), 3)
    ).toMatchObject({
      _tag: "Settled",
      outcome: "fixed"
    })
  })

  it("stops at the round limit and leaves the thread for a person", () => {
    const comments = [
      fromReviewer(1, "x"),
      fromAuthor(1, "y"),
      fromReviewer(2, "x"),
      fromAuthor(2, "y"),
      fromReviewer(3, "x"),
      fromAuthor(3, "y")
    ]
    expect(threadState(thread("a.ts", comments), 3)).toEqual({ _tag: "AtLimit", round: 3 })
    expect(threadState(thread("a.ts", comments.slice(0, 5)), 3)).toEqual({
      _tag: "Open",
      round: 3,
      waitingOn: "author"
    })
  })

  it("belongs to people when no agent wrote in it, or a person had the last word", () => {
    expect(threadState(thread("a.ts", [fromPerson(lee, "Nit")]), 3)).toEqual({ _tag: "Human" })
    expect(threadState(thread("a.ts", [fromReviewer(1, "x"), fromPerson(lee, "I disagree")]), 3)).toEqual({
      _tag: "Human"
    })
    expect(threadState(thread("a.ts", []), 3)).toEqual({ _tag: "Human" })
  })
})

describe("a thread the author answered with a commit instead of a reply", () => {
  it("is one waiting on the author whose code changed since", () => {
    const waiting = thread("a.ts", [fromReviewer(1, "Leaks the token")])

    expect(answeredByCommit({ ...waiting, changedSince: true }, 3)).toBe(true)
    expect(answeredByCommit(waiting, 3)).toBe(false)
    expect(answeredByCommit({ ...waiting, changedSince: true, resolved: true }, 3)).toBe(false)
    expect(
      answeredByCommit({ ...thread("a.ts", [fromReviewer(1, "Leaks"), fromAuthor(1, "Fixed")]), changedSince: true }, 3)
    ).toBe(false)
  })
})

describe("where a pull request sits on the board", () => {
  it("waits for review, then is requested once a reviewer or the intake label is on it", () => {
    expect(cardOf(pull(1), desk, authoring).stage).toBe("waiting")
    expect(cardOf(pull(1, { requested: [lee] }), desk, authoring).stage).toBe("requested")
    expect(cardOf(pull(1, { labels: [Text.make("agent-review")] }), desk, reviewing).stage).toBe("requested")
  })

  it("is with an agent once claimed, or once the reviewer agent has posted but not triaged", () => {
    expect(cardOf(pull(1), desk, { ...reviewing, claimed: true }).stage).toBe("reviewing")
    const summaryOnly = pull(1, {
      reviews: [{ ...review(dana, "commented", ""), body: fromReviewer(1, "Two findings").body }]
    })
    expect(cardOf(summaryOnly, desk, authoring).stage).toBe("ready")
    expect(cardOf(summaryOnly, desk, reviewing).stage).toBe("reviewing")
    expect(cardOf(pull(1, { comments: [fromReviewer(1, "Started")] }), desk, authoring).stage).toBe("ready")
  })

  it("is agents talking while a thread is open, with the round and whose turn it is", () => {
    const facts = pull(1, {
      threads: [
        thread("a.ts", [fromReviewer(1, "x"), fromAuthor(1, "y"), fromReviewer(2, "z")]),
        thread("b.ts", [fromReviewer(1, "q")])
      ]
    })
    const card = cardOf(facts, desk, triaged)
    expect(card.stage).toBe("talking")
    expect(card.round).toEqual({ number: 2, limit: 3, turn: "theirs" })
    expect(card.openThreads).toBe(2)
    expect(cardOf(facts, desk, authoring).round?.turn).toBe("mine")
  })

  it("is ready for you once every thread is settled or at the limit and the agent has triaged it", () => {
    const comments = [
      fromReviewer(1, "x"),
      fromAuthor(1, "y"),
      fromReviewer(2, "x"),
      fromAuthor(2, "y"),
      fromReviewer(3, "x"),
      fromAuthor(3, "y")
    ]
    const facts = pull(1, {
      threads: [
        thread("a.ts", [fromReviewer(1, "Missing await"), fromAuthor(1, "Added", "fixed")]),
        thread("b.ts", comments)
      ]
    })
    const card = cardOf(facts, desk, { ...triaged, agent: { session: SessionName.make("auth"), working: false } })
    expect(card.stage).toBe("ready")
    expect(card.round).toBeNull()
    expect(card.openThreads).toBe(1)
    expect(card.settled).toEqual([{ thread: "a.ts", outcome: "fixed", note: "Added" }])
    expect(card.triage?.verdict).toBe("skim")
  })

  it("is reviewed once the reviewing person, not an agent, leaves a review, and merged when merged", () => {
    expect(cardOf(pull(1, { reviews: [review(dana, "approved", "")] }), desk, triaged).stage).toBe("reviewed")
    expect(cardOf(pull(1, { reviews: [review(lee, "changes_requested", "No")] }), desk, triaged).stage).toBe(
      "reviewing"
    )
    expect(cardOf(pull(1, { reviews: [review(lee, "commented", "Thoughts")] }), desk, authoring).stage).toBe("reviewed")
    expect(cardOf(pull(1, { reviews: [review(lee, "commented", "  ")] }), desk, authoring).stage).toBe("waiting")
    expect(cardOf(pull(1, { state: "merged" }), desk, authoring).stage).toBe("merged")
    expect(
      cardOf(
        pull(1, { reviews: [{ ...review(dana, "approved", ""), body: fromReviewer(1, "ok").body }] }),
        desk,
        triaged
      ).stage
    ).toBe("ready")
  })

  it("carries what the desk knows about the pull request onto the card", () => {
    const card = cardOf(pull(7, { checks: "failed" }), desk, {
      ...authoring,
      trusted: false,
      relations: [{ kind: "depends-on", with: PrKey.make("github:acme/api#6"), label: Text.make("acme/api#6") }]
    })
    expect(card).toMatchObject({ number: 7, trusted: false, checks: "failed", relations: [{ kind: "depends-on" }] })
  })

  it("lists each agent thread with its status, round and whose turn, and the latest thing an agent said", () => {
    const comments = [
      fromReviewer(1, "x"),
      fromAuthor(1, "y"),
      fromReviewer(2, "x"),
      fromAuthor(2, "y"),
      fromReviewer(3, "x"),
      fromAuthor(3, "still no")
    ]
    const facts = pull(1, {
      threads: [
        thread("a.ts", [fromReviewer(1, "Missing await"), fromAuthor(1, "Added", "fixed")]),
        thread("b.ts", [fromReviewer(1, "Rename"), fromAuthor(1, "Why?"), fromReviewer(2, "Clarity")]),
        thread("c.ts", comments),
        thread("d.ts", [fromPerson(lee, "Nit")])
      ]
    })
    const card = cardOf(facts, desk, authoring)
    expect(card.threads).toEqual([
      { thread: "a.ts", status: "settled", outcome: "fixed", round: 1, turn: null, latest: "Added" },
      { thread: "b.ts", status: "open", outcome: null, round: 2, turn: "mine", latest: "Clarity" },
      { thread: "c.ts", status: "for-you", outcome: null, round: 3, turn: null, latest: "still no" }
    ])
    expect(card.activity).toEqual({ side: "author", text: "still no", at: comments[5]?.at })
    expect(cardOf(pull(2), desk, authoring).activity).toBeNull()
  })
})
