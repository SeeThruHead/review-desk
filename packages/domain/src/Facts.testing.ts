import { Count, IsoTime, Login, PrKey, PrNumber, RepoSlug, Text, Url, prKey } from "@review-desk/contract/Ids.ts"
import { Branch, type Comment, ForgeId, type PullFacts, type Review, type Thread } from "./Facts.ts"
import { type Marker, stamp } from "./Protocol.ts"

export const dana = Login.make("dana")
export const lee = Login.make("lee")

export const at = (minute: number) => IsoTime.make(`2026-11-05T10:${String(minute).padStart(2, "0")}:00Z`)

export const pull = (number: number, overrides: Partial<PullFacts> = {}): PullFacts => ({
  key: prKey("github", RepoSlug.make("acme/api"), PrNumber.make(number)),
  forge: "github",
  repo: RepoSlug.make("acme/api"),
  number: PrNumber.make(number),
  title: Text.make(`Change ${number}`),
  body: Text.make(""),
  url: Url.make(`https://github.com/acme/api/pull/${number}`),
  author: lee,
  head: Branch.make(`feature-${number}`),
  headSha: Text.make("abc1234"),
  base: Branch.make("main"),
  draft: false,
  state: "open",
  labels: [],
  requested: [],
  files: [],
  checks: "passed",
  mergeable: "yes",
  review: null,
  queue: null,
  reviews: [],
  threads: [],
  comments: [],
  updatedAt: at(0),
  ...overrides
})

const agentBody = (marker: Marker, text: string) => stamp({ marker, owner: "Dana", limit: 3 }, text)

export const fromReviewer = (round: number, text: string, outcome: Marker["outcome"] = "open"): Comment => ({
  id: ForgeId.make(`r${round}-${outcome}-${text.length}`),
  author: dana,
  body: agentBody({ side: "reviewer", round: Count.make(round), outcome, desk: dana }, text),
  at: at(round * 2),
  url: Url.make(`https://github.com/acme/api/pull/1#r${round}`)
})

export const fromAuthor = (round: number, text: string, outcome: Marker["outcome"] = "open"): Comment => ({
  id: ForgeId.make(`a${round}-${outcome}-${text.length}`),
  author: lee,
  body: agentBody({ side: "author", round: Count.make(round), outcome, desk: lee }, text),
  at: at(round * 2 + 1),
  url: Url.make(`https://github.com/acme/api/pull/1#a${round}`)
})

export const fromPerson = (login: Login, text: string): Comment => ({
  id: ForgeId.make(`p-${text.length}`),
  author: login,
  body: Text.make(text),
  at: at(30),
  url: Url.make("https://github.com/acme/api/pull/1#p")
})

export const thread = (path: string, comments: ReadonlyArray<Comment>, resolved = false): Thread => ({
  id: ForgeId.make(`t-${path}`),
  path: Text.make(path),
  line: 10,
  resolved,
  comments
})

export const review = (author: Login, state: Review["state"], body: string): Review => ({
  id: ForgeId.make(`rev-${author}-${state}`),
  author,
  state,
  body: Text.make(body),
  at: at(40),
  url: Url.make("https://github.com/acme/api/pull/1#review")
})

export const otherKey = (number: number) => PrKey.make(`github:acme/api#${number}`)
