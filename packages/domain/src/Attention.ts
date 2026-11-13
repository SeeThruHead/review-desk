import type { Attention, Card, Mention, Verdict } from "@review-desk/contract/Board.ts"
import { IsoTime, type Login, prKey, Text } from "@review-desk/contract/Ids.ts"
import { Array, Option, Order } from "effect"
import type { IssueFacts, PullFacts, Review, Thread } from "./Facts.ts"
import { excerpt, isFromAgent } from "./Protocol.ts"

export type Said = {
  readonly author: Login
  readonly body: string
  readonly at: string
  readonly bot: boolean
  readonly review: "approved" | "changes_requested" | null
}

export type Me = { readonly logins: ReadonlyArray<string> }

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const isMine = (me: Me, login: string): boolean => me.logins.some((mine) => same(mine, login))

const decided = (state: string): Said["review"] => {
  if (state === "approved") return "approved"
  if (state === "changes_requested") return "changes_requested"

  return null
}

const laterFrom = (reviews: ReadonlyArray<Review>, review: Review, index: number): boolean =>
  reviews.slice(index + 1).some((later) => same(later.author, review.author))

export const saidIn = (facts: PullFacts): ReadonlyArray<Said> => [
  ...facts.comments.map((comment) => ({ ...comment, bot: comment.bot === true, review: null })),
  ...facts.reviews.map((review, index) => ({
    ...review,
    bot: review.bot === true,
    review: laterFrom(facts.reviews, review, index) ? null : decided(review.state)
  })),
  ...facts.threads.flatMap((thread) =>
    thread.comments.map((comment) => ({ ...comment, bot: comment.bot === true, review: null }))
  )
]

const issueSaid = (issue: IssueFacts): ReadonlyArray<Said> => [
  { author: issue.author, body: issue.body, at: issue.createdAt, bot: false, review: null },
  ...issue.comments.map((comment) => ({ ...comment, bot: comment.bot === true, review: null }))
]

const pullOpening = (facts: PullFacts): ReadonlyArray<Said> => [
  { author: facts.author, body: facts.body, at: facts.createdAt ?? facts.updatedAt, bot: false, review: null }
]

export const isPerson = (me: Me, said: Said): boolean => {
  if (said.bot) return false
  if (isMine(me, said.author)) return false

  return !isFromAgent(said.body)
}

const isMyOwn = (me: Me, said: Said): boolean => isMine(me, said.author) && !isFromAgent(said.body)

const byTime = Order.mapInput(Order.String, (said: Said) => said.at)

const latest = (saids: ReadonlyArray<Said>): Option.Option<Said> => Array.last(Array.sort(saids, byTime))

const lastOwn = (me: Me, saids: ReadonlyArray<Said>): string =>
  Option.match(latest(saids.filter((said) => isMyOwn(me, said))), { onNone: () => "", onSome: (said) => said.at })

const loginPattern = (login: string): RegExp =>
  new RegExp(`(^|[^A-Za-z0-9_-])@${login.replaceAll(".", "\\.")}(?![A-Za-z0-9_-])`, "i")

export const mentionsMe = (me: Me, body: string): boolean => me.logins.some((login) => loginPattern(login).test(body))

const attention = (why: string, at: string): Attention => ({ why: Text.make(why), at: IsoTime.make(at) })

const verdictText: { readonly [V in Verdict]: string } = {
  architecture: "an architecture call for you",
  look: "worth a look",
  skim: "a skim"
}

export type Look = {
  readonly facts: PullFacts
  readonly card: Card
  readonly me: Me
  readonly asked: boolean
  readonly covered: boolean
  readonly leftQueue: boolean
}

const forYouThread = (card: Card): boolean => (card.threads ?? []).some((thread) => thread.status === "for-you")

const leftByMe =
  (me: Me) =>
  (thread: Thread): boolean => {
    const last = thread.comments.at(-1)
    if (thread.resolved || thread.changedSince !== true) return false
    if (last === undefined) return false

    return isMine(me, last.author) && !isFromAgent(last.body)
  }

const answeredByCommit = (look: Look): Attention | null => {
  const thread = look.facts.threads.find(leftByMe(look.me))
  if (thread === undefined) return null

  return attention(
    `${look.facts.author} changed the code under your comment on ${thread.path} without replying; check it is fixed`,
    look.facts.updatedAt
  )
}

const reviewerNeed = (look: Look): Attention | null => {
  const { card, facts } = look
  if (card.stage === "ready")
    return attention(
      card.triage === null
        ? "The agent's review is done"
        : `The agent's review is done: ${verdictText[card.triage.verdict]}`,
      card.activity?.at ?? facts.updatedAt
    )
  if (forYouThread(card)) return attention("A thread used all its agent rounds; it is yours now", facts.updatedAt)
  const fixed = answeredByCommit(look)
  if (fixed !== null) return fixed
  if (!look.asked || card.claimed || look.covered) return null
  if (card.stage !== "requested" && card.stage !== "waiting") return null

  return attention("Review requested of you; no agent area covers it", facts.updatedAt)
}

const feedbackText = (said: Said): string =>
  said.review === "changes_requested" ? `${said.author} requested changes` : `${said.author} commented`

const personFeedback = (look: Look): Attention | null => {
  const saids = saidIn(look.facts)
  const mine = lastOwn(look.me, saids)
  const fresh = saids.filter(
    (said) => isPerson(look.me, said) && said.at > mine && (said.review !== null || said.body.trim().length > 0)
  )
  const newest = latest(fresh.filter((said) => said.review !== "approved" || said.body.trim().length > 0))

  return Option.match(newest, { onNone: () => null, onSome: (said) => attention(feedbackText(said), said.at) })
}

const approvedAt = (facts: PullFacts): Option.Option<string> => {
  const byPerson = facts.reviews.filter((review) => review.bot !== true)
  const latestPer = byPerson.filter((review, index) => !laterFrom(byPerson, review, index))
  if (facts.review === "changes_requested") return Option.none()
  if (latestPer.some((review) => review.state === "changes_requested")) return Option.none()
  const approvals = latestPer.filter((review) => review.state === "approved").map((review) => review.at)
  if (facts.review !== "approved" && approvals.length === 0) return Option.none()

  return Option.some(Array.last(approvals.toSorted()).pipe(Option.getOrElse(() => facts.updatedAt)))
}

const readyToMerge = (facts: PullFacts): Option.Option<string> => {
  if (facts.draft || facts.queue !== null) return Option.none()
  if (facts.checks === "failed" || facts.checks === "pending") return Option.none()
  if (facts.mergeable !== "yes") return Option.none()

  return approvedAt(facts)
}

const failedCi = (card: Card): string | null => {
  if (card.checks !== "failed") return null
  if (card.agent?.working === true) return null

  return card.agent === null ? "CI failed and no agent is on it" : "CI failed and the agent stopped"
}

const authorNeed = (look: Look): Attention | null => {
  const { facts } = look
  if (look.leftQueue) return attention("Removed from the merge queue", facts.updatedAt)
  const feedback = personFeedback(look)
  if (feedback !== null) return feedback
  const ci = failedCi(look.card)
  if (ci !== null) return attention(ci, facts.updatedAt)

  return Option.match(readyToMerge(facts), {
    onNone: () => null,
    onSome: (at) => attention("Approved with CI passed: ready to merge", at)
  })
}

const unseen = (found: Attention | null, seenAt: string | null): Attention | null => {
  if (found === null) return null
  if (seenAt !== null && found.at <= seenAt) return null

  return found
}

export const attentionOf = (look: Look, seenAt: string | null): Attention | null => {
  if (look.facts.state !== "open") return null

  return unseen(look.card.role === "reviewer" ? reviewerNeed(look) : authorNeed(look), seenAt)
}

type Mentioned = Pick<Mention, "key" | "kind" | "forge" | "repo" | "number" | "title" | "url">

const mentionFrom = (
  me: Me,
  where: Mentioned,
  saids: ReadonlyArray<Said>,
  seenAt: string | null
): ReadonlyArray<Mention> => {
  const found = latest(saids.filter((said) => isPerson(me, said) && mentionsMe(me, said.body)))
  if (Option.isNone(found)) return []
  const said = found.value
  const answered = lastOwn(me, saids)
  const fresh = said.at > answered && (seenAt === null || said.at > seenAt)

  return [
    {
      ...where,
      by: said.author,
      text: Text.make(excerpt(said.body)),
      at: IsoTime.make(said.at),
      attention: fresh ? attention(`${said.author} mentioned you`, said.at) : null
    }
  ]
}

const placeOf = (
  facts: Pick<PullFacts | IssueFacts, "forge" | "repo" | "number" | "title" | "url">,
  kind: Mention["kind"]
): Mentioned => ({
  key: prKey(facts.forge, facts.repo, facts.number),
  kind,
  forge: facts.forge,
  repo: facts.repo,
  number: facts.number,
  title: facts.title,
  url: facts.url
})

export const pullMention = (me: Me, facts: PullFacts, seenAt: string | null): ReadonlyArray<Mention> =>
  facts.state === "open"
    ? mentionFrom(me, placeOf(facts, "pull"), [...pullOpening(facts), ...saidIn(facts)], seenAt)
    : []

export const issueMention = (me: Me, issue: IssueFacts, seenAt: string | null): ReadonlyArray<Mention> =>
  mentionFrom(me, placeOf(issue, "issue"), issueSaid(issue), seenAt)
