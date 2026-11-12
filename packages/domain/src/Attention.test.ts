import { describe, expect, it } from "@effect/vitest"
import type { Card } from "@review-desk/contract/Board.ts"
import { Count, IsoTime, Login, PrNumber, RepoSlug, SessionName, Text, Url } from "@review-desk/contract/Ids.ts"
import { type Look, attentionOf, issueMention, mentionsMe, pullMention } from "./Attention.ts"
import { ForgeId, type IssueFacts, type PullFacts } from "./Facts.ts"
import { at, dana, fromAuthor, fromReviewer, lee, pull, review, thread } from "./Facts.testing.ts"
import { type Context, cardOf } from "./Lifecycle.ts"

const me = { logins: ["dana", "dana.k"] }
const sam = Login.make("sam")
const desk = { logins: me.logins, limit: 3, intakeLabel: "agent-review" }

const context: Context = {
  role: "author",
  trusted: true,
  claimed: false,
  triage: null,
  agent: null,
  relations: [],
  delivered: null
}

const lookAt = (facts: PullFacts, overrides: Partial<Look> = {}, card: Partial<Card> = {}): Look => ({
  facts,
  card: { ...cardOf(facts, desk, context), ...card },
  me,
  asked: false,
  covered: false,
  leftQueue: false,
  ...overrides
})

const said = (author: Login, body: string, minute: number, extra: { readonly bot?: boolean } = {}) => ({
  id: ForgeId.make(`c-${author}-${minute}`),
  author,
  body: Text.make(body),
  at: at(minute),
  url: Url.make(`https://github.com/acme/api/pull/1#c${minute}`),
  ...extra
})

const why = (look: Look, seenAt: string | null = null) => attentionOf(look, seenAt)?.why ?? null

const mine = (overrides: Partial<PullFacts> = {}) => pull(1, { author: dana, checks: "pending", ...overrides })

const theirs = (overrides: Partial<PullFacts> = {}) => pull(2, overrides)

const reviewer = (facts: PullFacts, overrides: Partial<Look> = {}, card: Partial<Card> = {}) =>
  lookAt(facts, overrides, { role: "reviewer", ...card })

describe("what on his own pull request needs him", () => {
  it("needs nothing while it is quiet, open and waiting", () => {
    expect(why(lookAt(mine()))).toBeNull()
  })

  it("needs nothing once it is merged or closed", () => {
    expect(why(lookAt(mine({ state: "merged", checks: "failed" })))).toBeNull()
  })

  it("asks for him when it left the merge queue without merging", () => {
    expect(why(lookAt(mine(), { leftQueue: true }))).toBe("Removed from the merge queue")
  })

  it("asks for him when a person commented after his last own comment", () => {
    const facts = mine({ comments: [said(dana, "Pushed a fix", 1), said(sam, "Looks odd on mobile", 5)] })

    expect(attentionOf(lookAt(facts), null)).toEqual({ why: "sam commented", at: at(5) })
  })

  it("names a request for changes as one, including inline threads", () => {
    const facts = mine({
      reviews: [review(lee, "changes_requested", "")],
      threads: [thread("a.ts", [said(sam, "nit", 2)])]
    })

    expect(why(lookAt(facts))).toBe("lee requested changes")
  })

  it("leaves a person's comment once he answered it", () => {
    const facts = mine({ comments: [said(sam, "Question", 1), said(dana, "Answer", 2)] })

    expect(why(lookAt(facts))).toBeNull()
  })

  it("never counts bots, the agents' own comments, empty reviews or a bare approval as a person's feedback", () => {
    const facts = mine({
      comments: [said(Login.make("coderabbitai"), "Consider renaming", 3, { bot: true }), fromReviewer(1, "Rename")],
      reviews: [
        review(sam, "commented", ""),
        review(lee, "approved", ""),
        { ...review(sam, "commented", "Bot"), bot: true }
      ]
    })

    expect(why(lookAt(facts))).toBeNull()
  })

  it("does not take an agent's reply on his account as his own answer", () => {
    const facts = mine({ comments: [said(sam, "Why this?", 1), fromAuthor(2, "Because")] })

    expect(why(lookAt(facts))).toBe("sam commented")
  })

  it("counts an approval with a message as a person speaking", () => {
    expect(why(lookAt(mine({ reviews: [review(lee, "approved", "Ship it, one nit")] })))).toBe("lee commented")
  })

  it("asks for him when CI failed and no agent is on it", () => {
    expect(why(lookAt(mine({ checks: "failed" })))).toBe("CI failed and no agent is on it")
  })

  it("leaves a CI failure to an author agent while it works, and asks for him once it stops", () => {
    const facts = mine({ checks: "failed" })
    const working = { agent: { session: SessionName.make("fixer"), working: true } }
    const stopped = { agent: { session: SessionName.make("fixer"), working: false } }

    expect(why(lookAt(facts, {}, working))).toBeNull()
    expect(why(lookAt(facts, {}, stopped))).toBe("CI failed and the agent stopped")
  })

  it("says it is ready to merge once approved, green and free of conflicts", () => {
    const facts = mine({ checks: "passed", reviews: [review(lee, "approved", "")] })

    expect(attentionOf(lookAt(facts), null)).toEqual({ why: "Approved with CI passed: ready to merge", at: at(40) })
    expect(why(lookAt({ ...facts, checks: "none" }))).toBe("Approved with CI passed: ready to merge")
  })

  it("trusts GitHub's review decision when the approving review is out of reach", () => {
    expect(attentionOf(lookAt(mine({ checks: "passed", review: "approved" })), null)?.at).toBe(at(0))
  })

  it("is not ready to merge while anything still stands in the way", () => {
    const approved = mine({ checks: "passed", reviews: [review(lee, "approved", "")] })
    const queued = { state: Text.make("queued"), position: Count.make(1) }
    const blocked: ReadonlyArray<PullFacts> = [
      { ...approved, draft: true },
      { ...approved, queue: queued },
      { ...approved, checks: "failed" },
      { ...approved, checks: "pending" },
      { ...approved, mergeable: "no" },
      { ...approved, review: "changes_requested" },
      { ...approved, reviews: [...approved.reviews, { ...review(sam, "changes_requested", ""), at: at(39) }] },
      { ...approved, reviews: [{ ...review(lee, "approved", ""), bot: true }] },
      {
        ...approved,
        reviews: [...approved.reviews, { ...review(sam, "changes_requested", ""), at: at(39) }],
        comments: [said(dana, "Fixed both", 45)]
      },
      mine({ checks: "passed" })
    ]

    expect(blocked.map((facts) => why(lookAt(facts)))).not.toContain("Approved with CI passed: ready to merge")
    expect(why(lookAt({ ...approved, checks: "failed" }))).toBe("CI failed and no agent is on it")
  })

  it("counts only each person's latest review", () => {
    const facts = mine({
      checks: "passed",
      reviews: [
        { ...review(lee, "changes_requested", ""), at: at(10) },
        { ...review(lee, "approved", ""), at: at(20) }
      ]
    })

    expect(why(lookAt(facts))).toBe("Approved with CI passed: ready to merge")
  })

  it("stays quiet once he marked it seen, until something newer happens", () => {
    const facts = mine({ comments: [said(sam, "One question", 5)] })

    expect(why(lookAt(facts), at(6))).toBeNull()
    expect(why(lookAt(facts), at(4))).toBe("sam commented")
  })
})

describe("what on a pull request he reviews needs him", () => {
  it("asks for him when the agent's review is done, with its verdict", () => {
    const facts = theirs()

    expect(why(reviewer(facts, {}, { stage: "ready" }))).toBe("The agent's review is done")
    expect(
      attentionOf(
        reviewer(
          facts,
          {},
          {
            stage: "ready",
            triage: { verdict: "architecture", reason: Text.make("Moves token lifetime") },
            activity: { side: "reviewer", text: Text.make("Summary"), at: at(9) }
          }
        ),
        null
      )
    ).toEqual({ why: "The agent's review is done: an architecture call for you", at: at(9) })
  })

  it("asks for him when a thread used all its agent rounds", () => {
    const view = {
      thread: Text.make("a.ts"),
      status: "for-you" as const,
      outcome: null,
      round: Count.make(3),
      turn: null,
      latest: Text.make("")
    }

    expect(why(reviewer(theirs(), {}, { stage: "talking", threads: [view] }))).toBe(
      "A thread used all its agent rounds; it is yours now"
    )
    const talking = reviewer(theirs(), {}, { stage: "talking" })
    const { threads: _, ...withoutThreads } = talking.card
    expect(why({ ...talking, card: withoutThreads })).toBeNull()
  })

  it("asks for him when his review was requested and no agent area covers it", () => {
    const asked = { asked: true }

    expect(why(reviewer(theirs(), asked, { stage: "requested" }))).toBe(
      "Review requested of you; no agent area covers it"
    )
    expect(why(reviewer(theirs(), asked, { stage: "waiting" }))).toBe(
      "Review requested of you; no agent area covers it"
    )
  })

  it("leaves a request to the agent that covers it or claimed it, and anything already under way", () => {
    expect(why(reviewer(theirs(), { asked: true, covered: true }, { stage: "requested" }))).toBeNull()
    expect(why(reviewer(theirs(), { asked: true }, { stage: "requested", claimed: true }))).toBeNull()
    expect(why(reviewer(theirs(), { asked: true }, { stage: "reviewing" }))).toBeNull()
    expect(why(reviewer(theirs(), {}, { stage: "requested" }))).toBeNull()
  })
})

describe("mentions", () => {
  it("finds his logins as whole @names only", () => {
    expect(mentionsMe(me, "cc @dana")).toBe(true)
    expect(mentionsMe(me, "(@DANA.K)")).toBe(true)
    expect(mentionsMe(me, "@danakx and dana and @dana-x and x@dana")).toBe(false)
  })

  it("shows a mention on a pull request he is not otherwise on, and asks for him until he answers or marks it seen", () => {
    const facts = pull(3, { createdAt: at(1), comments: [said(sam, "@dana can you check the copy?", 5)] })

    expect(pullMention(me, facts, null)).toEqual([
      {
        key: facts.key,
        kind: "pull",
        forge: "github",
        repo: facts.repo,
        number: facts.number,
        title: facts.title,
        url: facts.url,
        by: sam,
        text: "@dana can you check the copy?",
        at: at(5),
        attention: { why: "sam mentioned you", at: at(5) }
      }
    ])
    expect(pullMention(me, facts, at(6))[0]?.attention).toBeNull()
    expect(
      pullMention(me, { ...facts, comments: [...facts.comments, said(dana, "Done", 7)] }, null)[0]?.attention
    ).toBeNull()
  })

  it("reads the description too, dated when it was opened", () => {
    expect(pullMention(me, pull(4, { body: Text.make("cc @dana") }), null)[0]?.at).toBe(at(0))
    expect(pullMention(me, pull(4, { body: Text.make("cc @dana"), createdAt: at(3) }), null)[0]?.at).toBe(at(3))
  })

  it("ignores his own, bots' and agents' mentions, and closed pull requests", () => {
    const facts = pull(5, {
      comments: [said(dana, "@dana note to self", 1), said(Login.make("ci"), "@dana build", 2, { bot: true })],
      threads: [thread("a.ts", [fromReviewer(1, "@dana see this")])]
    })

    expect(pullMention(me, facts, null)).toEqual([])
    expect(pullMention(me, { ...pull(6, { body: Text.make("@dana") }), state: "closed" }, null)).toEqual([])
  })

  it("shows an issue that mentions him", () => {
    const issue: IssueFacts = {
      forge: "github",
      repo: RepoSlug.make("acme/api"),
      number: PrNumber.make(31),
      id: ForgeId.make("31"),
      title: Text.make("Retries pile up"),
      body: Text.make("Seen after deploys"),
      url: Url.make("https://github.com/acme/api/issues/31"),
      author: lee,
      createdAt: IsoTime.make(at(1)),
      comments: [said(sam, "@dana does the queue drain?", 4), said(Login.make("bot"), "@dana", 9, { bot: true })]
    }

    expect(issueMention(me, issue, null)).toMatchObject([
      { key: "github:acme/api#31", kind: "issue", by: sam, attention: { why: "sam mentioned you" } }
    ])
  })
})
