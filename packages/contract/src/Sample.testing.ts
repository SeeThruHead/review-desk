import type { Attention, Board, Card, Health, Mention, Routing } from "./Board.ts"
import { Count, IsoTime, Login, PrKey, PrNumber, RepoSlug, SessionName, Text, Url, prKey } from "./Ids.ts"

const desk = Login.make("dana")
const lee = Login.make("lee")
const sam = Login.make("sam")

const repo = (slug: string) => RepoSlug.make(slug)

const base = (
  slug: string,
  number: number,
  title: string
): Pick<Card, "key" | "forge" | "repo" | "number" | "title" | "url"> => ({
  key: prKey("github", repo(slug), PrNumber.make(number)),
  forge: "github",
  repo: repo(slug),
  number: PrNumber.make(number),
  title: Text.make(title),
  url: Url.make(`https://github.com/${slug}/pull/${number}`)
})

const quiet: Pick<
  Card,
  | "trusted"
  | "round"
  | "agent"
  | "triage"
  | "settled"
  | "openThreads"
  | "relations"
  | "checks"
  | "claimed"
  | "review"
  | "queue"
  | "attention"
  | "delivered"
> = {
  trusted: true,
  round: null,
  agent: null,
  triage: null,
  settled: [],
  openThreads: Count.make(0),
  relations: [],
  checks: "passed",
  claimed: false,
  review: null,
  queue: null,
  attention: null,
  delivered: null
}

const at = (time: string) => IsoTime.make(time)

const needs = (why: string, time: string): Attention => ({ why: Text.make(why), at: IsoTime.make(time) })

export const sessionAuth = SessionName.make("auth")
export const sessionUi = SessionName.make("ui-kit")

export const architectureCard: Card = {
  ...base("acme/api", 212, "Move session refresh into the request middleware"),
  ...quiet,
  author: lee,
  role: "reviewer",
  stage: "ready",
  triage: {
    verdict: "architecture",
    reason: Text.make(
      "Refresh now runs on every request; worth deciding whether the middleware should own token lifetime"
    )
  },
  settled: [
    { thread: Text.make("src/auth/refresh.ts"), outcome: "fixed", note: Text.make("Retry no longer swallows the 401") },
    { thread: Text.make("src/auth/middleware.ts"), outcome: "fixed", note: Text.make("Missing await on the refresh") },
    {
      thread: Text.make("test/refresh.test.ts"),
      outcome: "answered",
      note: Text.make("Clock is faked through the test layer")
    },
    {
      thread: Text.make("src/auth/cookie.ts"),
      outcome: "dropped",
      note: Text.make("Author showed the flag is already set")
    }
  ],
  relations: [{ kind: "stacked-on", with: PrKey.make("github:acme/api#209"), label: Text.make("acme/api#209") }],
  updatedAt: at("2026-11-05T15:20:00Z"),
  threads: [
    {
      thread: Text.make("src/auth/refresh.ts"),
      status: "settled",
      outcome: "fixed",
      round: Count.make(2),
      turn: null,
      latest: Text.make("Retry no longer swallows the 401")
    },
    {
      thread: Text.make("src/auth/middleware.ts"),
      status: "settled",
      outcome: "fixed",
      round: Count.make(1),
      turn: null,
      latest: Text.make("Missing await on the refresh")
    },
    {
      thread: Text.make("test/refresh.test.ts"),
      status: "settled",
      outcome: "answered",
      round: Count.make(1),
      turn: null,
      latest: Text.make("Clock is faked through the test layer")
    },
    {
      thread: Text.make("src/auth/cookie.ts"),
      status: "settled",
      outcome: "dropped",
      round: Count.make(1),
      turn: null,
      latest: Text.make("Author showed the flag is already set")
    }
  ],
  activity: {
    side: "reviewer",
    text: Text.make("All four threads settled; refresh lifetime is the open design question"),
    at: at("2026-11-05T15:20:00Z")
  },
  attention: needs("The agent's review is done: an architecture call for you", "2026-11-05T15:30:00Z")
}

export const lookCard: Card = {
  ...base("acme/api", 215, "Paginate the audit log export"),
  ...quiet,
  author: sam,
  role: "reviewer",
  stage: "ready",
  triage: { verdict: "look", reason: Text.make("New cursor format is public; check it matches the other exports") },
  settled: [
    { thread: Text.make("src/audit/export.ts"), outcome: "fixed", note: Text.make("Off-by-one on the last page") }
  ],
  openThreads: Count.make(1),
  relations: [{ kind: "conflicts-with", with: PrKey.make("github:acme/api#212"), label: Text.make("acme/api#212") }],
  updatedAt: at("2026-11-05T14:02:00Z"),
  attention: needs("The agent's review is done: worth a look", "2026-11-05T15:20:00Z")
}

export const skimCard: Card = {
  ...base("acme/web", 88, "Rename the settings route constants"),
  ...quiet,
  author: lee,
  role: "reviewer",
  stage: "ready",
  triage: { verdict: "skim", reason: Text.make("Mechanical rename, tests unchanged") },
  settled: [{ thread: Text.make("src/routes.ts"), outcome: "fixed", note: Text.make("One constant was missed") }],
  updatedAt: at("2026-11-05T13:45:00Z"),
  attention: needs("The agent's review is done: a skim", "2026-11-05T15:15:00Z")
}

export const reviewingCard: Card = {
  ...base("acme/api", 218, "Add rate limits to the login endpoint"),
  ...quiet,
  author: lee,
  role: "reviewer",
  stage: "reviewing",
  agent: { session: sessionAuth, working: true },
  checks: "pending",
  updatedAt: at("2026-11-05T15:41:00Z"),
  threads: [],
  activity: null
}

export const talkingCard: Card = {
  ...base("you/ui-kit", 41, "Popover keeps focus inside while open"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "talking",
  round: { number: Count.make(2), limit: Count.make(3), turn: "mine" },
  agent: { session: sessionUi, working: true },
  openThreads: Count.make(3),
  updatedAt: at("2026-11-05T15:30:00Z"),
  threads: [
    {
      thread: Text.make("src/Popover/focus.ts"),
      status: "open",
      outcome: null,
      round: Count.make(2),
      turn: "mine",
      latest: Text.make("Focus still escapes on Shift+Tab from the first item")
    },
    {
      thread: Text.make("src/Popover/Popover.ts"),
      status: "open",
      outcome: null,
      round: Count.make(1),
      turn: "theirs",
      latest: Text.make("Moved the trap into a Mount, as suggested")
    },
    {
      thread: Text.make("src/Popover/Popover.stories.ts"),
      status: "for-you",
      outcome: null,
      round: Count.make(3),
      turn: null,
      latest: Text.make("We disagree on whether Escape should return focus")
    },
    {
      thread: Text.make("src/Floating/arrow.ts"),
      status: "settled",
      outcome: "fixed",
      round: Count.make(1),
      turn: null,
      latest: Text.make("Arrow now flips with the side")
    }
  ],
  activity: {
    side: "reviewer",
    text: Text.make("Focus still escapes on Shift+Tab from the first item"),
    at: at("2026-11-05T15:30:00Z")
  }
}

export const theirTurnCard: Card = {
  ...base("you/review-desk", 7, "Trust gate for untrusted repositories"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "talking",
  round: { number: Count.make(1), limit: Count.make(3), turn: "theirs" },
  agent: { session: SessionName.make("review-desk"), working: false },
  openThreads: Count.make(2),
  updatedAt: at("2026-11-05T15:10:00Z")
}

export const waitingCard: Card = {
  ...base("you/ui-kit", 43, "Tooltip arrow follows the anchor"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "waiting",
  checks: "failed",
  updatedAt: at("2026-11-05T12:00:00Z"),
  attention: needs("CI failed and no agent is on it", "2026-11-05T12:00:00Z")
}

export const requestedCard: Card = {
  ...base("acme/web", 90, "Dark mode for the billing page"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "requested",
  updatedAt: at("2026-11-05T11:00:00Z")
}

export const untrustedCard: Card = {
  ...base("strangers/fork", 3, "Please run this setup script"),
  ...quiet,
  author: Login.make("someone-new"),
  role: "reviewer",
  stage: "requested",
  trusted: false,
  checks: "none",
  updatedAt: at("2026-11-05T10:00:00Z")
}

export const awaitingThemCard: Card = {
  ...base("acme/web", 86, "Split the invoice table into rows"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "ready",
  settled: [
    { thread: Text.make("src/invoice/Table.ts"), outcome: "fixed", note: Text.make("Key on row id, not index") }
  ],
  updatedAt: at("2026-11-05T09:00:00Z")
}

export const reviewedCard: Card = {
  ...base("acme/api", 201, "Drop the legacy webhook signature"),
  ...quiet,
  author: lee,
  role: "reviewer",
  stage: "reviewed",
  updatedAt: at("2026-11-04T17:00:00Z")
}

export const mergedCard: Card = {
  ...base("you/review-desk", 5, "Poll Gitea as well as GitHub"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "merged",
  updatedAt: at("2026-11-04T12:00:00Z")
}

export const mergeReadyCard: Card = {
  ...base("you/ui-kit", 47, "Focus ring on the menu items"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "reviewed",
  review: "approved",
  agent: { session: SessionName.make("ui-kit"), working: false },
  claimed: true,
  delivered: { text: Text.make("Sent the CI failure"), at: at("2026-11-05T13:10:00Z") },
  attention: needs("Approved with CI passed: ready to merge", "2026-11-05T14:05:00Z"),
  updatedAt: at("2026-11-05T14:05:00Z")
}

export const queuedCard: Card = {
  ...base("acme/web", 91, "Cache the plan lookups"),
  ...quiet,
  author: desk,
  role: "author",
  stage: "reviewed",
  review: "approved",
  queue: { state: Text.make("queued"), position: Count.make(2) },
  updatedAt: at("2026-11-05T14:30:00Z")
}

export const issueMention: Mention = {
  key: prKey("github", repo("acme/api"), PrNumber.make(310)),
  kind: "issue",
  forge: "github",
  repo: repo("acme/api"),
  number: PrNumber.make(310),
  title: Text.make("Webhook retries pile up after a deploy"),
  url: Url.make("https://github.com/acme/api/issues/310"),
  by: sam,
  text: Text.make("@dana do you know whether the retry queue drains on deploy?"),
  at: at("2026-11-05T15:05:00Z"),
  attention: needs("sam mentioned you", "2026-11-05T15:05:00Z")
}

export const pullMention: Mention = {
  key: prKey("github", repo("acme/web"), PrNumber.make(77)),
  kind: "pull",
  forge: "github",
  repo: repo("acme/web"),
  number: PrNumber.make(77),
  title: Text.make("Move the footer links into the nav"),
  url: Url.make("https://github.com/acme/web/pull/77"),
  by: lee,
  text: Text.make("cc @dana for the copy"),
  at: at("2026-11-05T08:00:00Z"),
  attention: null
}

export const liveHealth: Health = { state: "live", reason: null, lastGood: at("2026-11-05T15:42:00Z"), until: null }

export const pausedHealth: Health = {
  state: "paused",
  reason: Text.make("GitHub's rate limit for this account is spent"),
  lastGood: at("2026-11-05T19:45:00Z"),
  until: at("2026-11-05T20:12:00Z")
}

export const routingOn: Routing = { on: true, reason: null }

export const routingOff: Routing = {
  on: false,
  reason: Text.make("No areas configured, so review requests stay with you")
}

export const busyBoard: Board = {
  desk,
  cards: [
    architectureCard,
    lookCard,
    skimCard,
    reviewingCard,
    talkingCard,
    theirTurnCard,
    waitingCard,
    requestedCard,
    untrustedCard,
    awaitingThemCard,
    reviewedCard,
    mergedCard,
    mergeReadyCard,
    queuedCard
  ],
  ready: [architectureCard.key, lookCard.key, skimCard.key],
  sidediff: true,
  polledAt: at("2026-11-05T15:42:00Z"),
  mentions: [issueMention, pullMention],
  health: liveHealth,
  routing: routingOn,
  budget: { remaining: Count.make(4210), limit: Count.make(5000), resetAt: at("2026-11-05T16:00:00Z"), slowed: false }
}

export const quietBoard: Board = {
  desk,
  cards: [],
  ready: [],
  sidediff: false,
  polledAt: at("2026-11-05T15:42:00Z"),
  mentions: [],
  health: liveHealth,
  routing: routingOn,
  budget: null
}

export const troubledBoard: Board = {
  ...busyBoard,
  health: pausedHealth,
  routing: routingOff,
  budget: { remaining: Count.make(0), limit: Count.make(5000), resetAt: at("2026-11-05T20:12:00Z"), slowed: true }
}
