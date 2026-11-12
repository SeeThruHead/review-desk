import type { Budget, Checks, ReviewDecision } from "@review-desk/contract/Board.ts"
import { Count, IsoTime, Login, PrNumber, type RepoSlug, Text, Url, prKey } from "@review-desk/contract/Ids.ts"
import { Branch, ForgeId, type IssueFacts, type PullFacts } from "@review-desk/domain/Facts.ts"
import { DateTime, Duration, Effect, Option, Ref, Schema, Semaphore } from "effect"
import { Headers, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { type ForgeClient, ForgeError, type Post } from "./Forge.ts"
import {
  type Answer,
  type Brief,
  type Cached,
  type RateLimit,
  type Reading,
  changedIds,
  chunksOf,
  listDue,
  paceOf,
  readDue,
  refusalOf,
  resumeAt,
  stampOf,
  uniqueById,
  verdictOf
} from "./GitHubPoll.ts"
import { searchesFor } from "./GitHubSearch.ts"

const Author = Schema.NullOr(Schema.Struct({ login: Schema.String, kind: Schema.optionalKey(Schema.String) }))
const Nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) })

const CommentNode = Schema.Struct({
  databaseId: Schema.Finite,
  body: Schema.String,
  createdAt: Schema.String,
  url: Schema.String,
  author: Author
})

const PullNode = Schema.Struct({
  number: Schema.Finite,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  state: Schema.Literals(["OPEN", "MERGED", "CLOSED"]),
  isDraft: Schema.Boolean,
  mergeable: Schema.Literals(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  createdAt: Schema.optionalKey(Schema.String),
  updatedAt: Schema.String,
  reviewDecision: Schema.optionalKey(Schema.NullOr(Schema.String)),
  mergeQueueEntry: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ state: Schema.String, position: Schema.NullOr(Schema.Finite) }))
  ),
  headRefName: Schema.String,
  baseRefName: Schema.String,
  headRefOid: Schema.String,
  author: Author,
  labels: Nodes(Schema.Struct({ name: Schema.String })),
  reviewRequests: Nodes(
    Schema.Struct({ requestedReviewer: Schema.NullOr(Schema.Struct({ login: Schema.optionalKey(Schema.String) })) })
  ),
  files: Schema.NullOr(Nodes(Schema.Struct({ path: Schema.String }))),
  latest: Nodes(
    Schema.Struct({
      commit: Schema.Struct({ statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })) })
    })
  ),
  reviews: Nodes(
    Schema.Struct({
      databaseId: Schema.Finite,
      state: Schema.String,
      body: Schema.String,
      submittedAt: Schema.NullOr(Schema.String),
      url: Schema.String,
      author: Author
    })
  ),
  comments: Nodes(CommentNode),
  reviewThreads: Nodes(
    Schema.Struct({
      isResolved: Schema.Boolean,
      path: Schema.String,
      line: Schema.NullOr(Schema.Finite),
      comments: Nodes(CommentNode)
    })
  )
})
type PullNode = typeof PullNode.Type

const BriefNode = Schema.Struct({
  id: Schema.String,
  updatedAt: Schema.String,
  latest: Nodes(
    Schema.Struct({
      commit: Schema.Struct({ statusCheckRollup: Schema.NullOr(Schema.Struct({ state: Schema.String })) })
    })
  )
})

const IssueBriefNode = Schema.Struct({ id: Schema.String, updatedAt: Schema.String })

const RateNode = Schema.Struct({ limit: Schema.Finite, remaining: Schema.Finite, resetAt: Schema.String })

const ListData = Schema.Struct({
  involved: Nodes(BriefNode),
  requested: Nodes(BriefNode),
  reviewed: Nodes(BriefNode),
  labelled: Nodes(BriefNode),
  merged: Nodes(BriefNode),
  mentioned: Nodes(Schema.Union([IssueBriefNode, Schema.Struct({})])),
  rateLimit: Schema.NullOr(RateNode)
})

const DetailData = Schema.Struct({
  nodes: Schema.Array(Schema.NullOr(Schema.Struct({ id: Schema.String, ...PullNode.fields })))
})

const briefOf = (node: typeof BriefNode.Type): Brief => ({
  id: node.id,
  updatedAt: node.updatedAt,
  checks: node.latest.nodes[0]?.commit.statusCheckRollup?.state ?? null
})

export const LIST_QUERY = `query($involved: String!, $requested: String!, $reviewed: String!, $labelled: String!, $merged: String!, $mentioned: String!) {
  involved: search(query: $involved, type: ISSUE, first: 50) { nodes { ...Brief } }
  requested: search(query: $requested, type: ISSUE, first: 50) { nodes { ...Brief } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 50) { nodes { ...Brief } }
  labelled: search(query: $labelled, type: ISSUE, first: 50) { nodes { ...Brief } }
  merged: search(query: $merged, type: ISSUE, first: 10) { nodes { ...Brief } }
  mentioned: search(query: $mentioned, type: ISSUE, first: 20) { nodes { ... on Issue { id updatedAt } } }
  rateLimit { limit remaining resetAt }
}
fragment Brief on PullRequest { id updatedAt latest: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`

const AUTHOR = "author { login kind: __typename }"

const PULL_FIELDS = `fragment Pull on PullRequest {
    id number title body url state isDraft mergeable createdAt updatedAt headRefName baseRefName headRefOid
    reviewDecision mergeQueueEntry { state position }
    ${AUTHOR}
    labels(first: 20) { nodes { name } }
    reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
    files(first: 100) { nodes { path } }
    latest: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    reviews(last: 50) { nodes { databaseId state body submittedAt url ${AUTHOR} } }
    comments(last: 50) { nodes { databaseId body createdAt url ${AUTHOR} } }
    reviewThreads(last: 50) { nodes { isResolved path line comments(first: 30) { nodes { databaseId body createdAt url ${AUTHOR} } } } }
}`

export const DETAIL_QUERY = `query($ids: [ID!]!) { nodes(ids: $ids) { ...Pull } }
${PULL_FIELDS}`

const detailBatch = 50

const loginOf = (author: typeof Author.Type): Login => Login.make(author?.login.replace(/\[bot\]$/, "") ?? "ghost")

const isBot = (author: typeof Author.Type): boolean => {
  if (author === null) return false
  if (author.kind === "Bot") return true

  return author.login.endsWith("[bot]")
}

const decisionOf = (decision: string | null | undefined): ReviewDecision | null => {
  if (decision === "APPROVED") return "approved"
  if (decision === "CHANGES_REQUESTED") return "changes_requested"
  if (decision === "REVIEW_REQUIRED") return "review_required"

  return null
}

const queueOf = (entry: PullNode["mergeQueueEntry"]) =>
  entry === null || entry === undefined
    ? null
    : {
        state: Text.make(entry.state.toLowerCase()),
        position: entry.position === null ? null : Count.make(entry.position)
      }

const checksOf = (state: string | undefined): Checks => {
  if (state === undefined) return "none"
  if (state === "SUCCESS") return "passed"
  if (state === "PENDING" || state === "EXPECTED") return "pending"

  return "failed"
}

const reviewState = (state: string) => {
  if (state === "APPROVED") return "approved" as const
  if (state === "CHANGES_REQUESTED") return "changes_requested" as const
  if (state === "DISMISSED") return "dismissed" as const
  if (state === "PENDING") return "pending" as const

  return "commented" as const
}

const pullState = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const

const mergeableOf = { MERGEABLE: "yes", CONFLICTING: "no", UNKNOWN: "unknown" } as const

const comment = (node: typeof CommentNode.Type) => ({
  id: ForgeId.make(String(node.databaseId)),
  author: loginOf(node.author),
  body: Text.make(node.body),
  at: IsoTime.make(node.createdAt),
  url: Url.make(node.url),
  ...(isBot(node.author) ? { bot: true } : {})
})

export const factsOf = (repo: RepoSlug, node: PullNode): PullFacts => ({
  key: prKey("github", repo, PrNumber.make(node.number)),
  forge: "github",
  repo,
  number: PrNumber.make(node.number),
  title: Text.make(node.title),
  body: Text.make(node.body),
  url: Url.make(node.url),
  author: loginOf(node.author),
  head: Branch.make(node.headRefName),
  headSha: Text.make(node.headRefOid),
  base: Branch.make(node.baseRefName),
  draft: node.isDraft,
  state: pullState[node.state],
  labels: node.labels.nodes.map((label) => Text.make(label.name)),
  requested: node.reviewRequests.nodes.flatMap((request) =>
    request.requestedReviewer?.login === undefined ? [] : [Login.make(request.requestedReviewer.login)]
  ),
  files: (node.files?.nodes ?? []).map((file) => Text.make(file.path)),
  checks: checksOf(node.latest.nodes[0]?.commit.statusCheckRollup?.state),
  mergeable: mergeableOf[node.mergeable],
  review: decisionOf(node.reviewDecision),
  queue: queueOf(node.mergeQueueEntry),
  reviews: node.reviews.nodes.map((review) => ({
    id: ForgeId.make(String(review.databaseId)),
    author: loginOf(review.author),
    state: reviewState(review.state),
    body: Text.make(review.body),
    at: IsoTime.make(review.submittedAt ?? node.updatedAt),
    url: Url.make(review.url),
    ...(isBot(review.author) ? { bot: true } : {})
  })),
  threads: node.reviewThreads.nodes.map((thread) => ({
    id: ForgeId.make(String(thread.comments.nodes[0]?.databaseId ?? `${thread.path}:${thread.line}`)),
    path: Text.make(thread.path),
    line: thread.line,
    resolved: thread.isResolved,
    comments: thread.comments.nodes.map(comment)
  })),
  comments: node.comments.nodes.map(comment),
  ...(node.createdAt === undefined ? {} : { createdAt: IsoTime.make(node.createdAt) }),
  updatedAt: IsoTime.make(node.updatedAt)
})

const Created = Schema.Struct({ html_url: Schema.String })

const IssueNode = Schema.Struct({
  number: Schema.Finite,
  databaseId: Schema.Finite,
  title: Schema.String,
  body: Schema.String,
  url: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.optionalKey(Schema.String),
  author: Author,
  comments: Nodes(CommentNode)
})

const IssuesData = Schema.Struct({ repository: Schema.NullOr(Schema.Struct({ issues: Nodes(IssueNode) })) })

const ISSUES_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: [OPEN], first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number databaseId title body url createdAt ${AUTHOR}
        comments(last: 50) { nodes { databaseId body createdAt url ${AUTHOR} } }
      }
    }
  }
}`

const issueOf =
  (repo: RepoSlug) =>
  (node: typeof IssueNode.Type): IssueFacts => ({
    forge: "github",
    repo,
    number: PrNumber.make(node.number),
    id: ForgeId.make(String(node.databaseId)),
    title: Text.make(node.title),
    body: Text.make(node.body),
    url: Url.make(node.url),
    author: loginOf(node.author),
    createdAt: IsoTime.make(node.createdAt),
    comments: node.comments.nodes.map(comment),
    ...(node.updatedAt === undefined ? {} : { updatedAt: IsoTime.make(node.updatedAt) })
  })

const MentionData = Schema.Struct({
  nodes: Schema.Array(Schema.NullOr(Schema.Struct({ id: Schema.String, ...IssueNode.fields })))
})

export const MENTION_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id number databaseId title body url createdAt updatedAt ${AUTHOR}
      comments(last: 30) { nodes { databaseId body createdAt url ${AUTHOR} } }
    }
  }
}`

const failed = (error: { readonly message: string }) => new ForgeError({ forge: "github", reason: error.message })

const isoOf = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis))

const pausedError = (reason: string, until: number) =>
  new ForgeError({ forge: "github", reason, paused: true, until: isoOf(until) })

const isIssueBrief = (node: object): node is typeof IssueBriefNode.Type => "id" in node

const millisOf = (iso: string): number => DateTime.toEpochMillis(DateTime.makeUnsafe(iso))

const budgetOf = (rate: RateLimit | null): Budget | null =>
  rate === null
    ? null
    : {
        remaining: Count.make(Math.max(0, Math.round(rate.remaining))),
        limit: Count.make(Math.max(0, Math.round(rate.limit))),
        resetAt: IsoTime.make(rate.resetAt),
        slowed: paceOf(rate) !== "go"
      }

const currentRate = (rate: RateLimit | null, nowMillis: number): RateLimit | null =>
  rate !== null && millisOf(rate.resetAt) > nowMillis ? rate : null

const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

const bodyOf = (text: string): unknown => Option.getOrElse(decodeJson(text), () => text)

const answerOf = (response: HttpClientResponse.HttpClientResponse, text: string): Answer => ({
  status: response.status,
  remaining: Headers.get(response.headers, "x-ratelimit-remaining"),
  retryAfter: Headers.get(response.headers, "retry-after"),
  reset: Headers.get(response.headers, "x-ratelimit-reset"),
  body: bodyOf(text)
})

const requestFor = (pull: PullFacts, post: Post) => {
  if (post.replyTo !== null)
    return HttpClientRequest.post(`/repos/${pull.repo}/pulls/${pull.number}/comments/${post.replyTo}/replies`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ body: post.body })
    )
  if (post.path !== null)
    return HttpClientRequest.post(`/repos/${pull.repo}/pulls/${pull.number}/comments`).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        body: post.body,
        commit_id: pull.headSha,
        path: post.path,
        line: post.line ?? 1,
        side: "RIGHT"
      })
    )

  return HttpClientRequest.post(`/repos/${pull.repo}/issues/${pull.number}/comments`).pipe(
    HttpClientRequest.bodyJsonUnsafe({ body: post.body })
  )
}

type Probe = { readonly etag: string; readonly generation: number; readonly at: number }

const changeProbe = (repo: RepoSlug, known: Probe | undefined) =>
  HttpClientRequest.get(`/repos/${repo}/issues`).pipe(
    HttpClientRequest.setUrlParams({ state: "all", sort: "updated", direction: "desc", per_page: "5" }),
    HttpClientRequest.setHeaders(known === undefined || known.etag === "" ? {} : { "if-none-match": known.etag })
  )

const safetyMillis = 15 * 60 * 1000

const gap = Duration.seconds(1)

type Kept<A> = { readonly reading: Reading; readonly facts: ReadonlyArray<A> }

const isPending = (pull: PullFacts): boolean => pull.state === "open" && pull.checks === "pending"

export const gitHubClient = Effect.fnUntraced(function* (
  api: string,
  token: string,
  intakeLabel: string,
  pollSeconds: number,
  login: string
) {
  const raw = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(api),
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("user-agent", "review-desk"),
        HttpClientRequest.setHeader("accept", "application/vnd.github+json")
      )
    )
  )
  const http = raw.pipe(HttpClient.filterStatusOk)
  const gate = yield* Semaphore.make(1)
  const pausedUntil = yield* Ref.make(0)
  const pauseReason = yield* Ref.make("")
  const strikes = yield* Ref.make(0)
  const cache = yield* Ref.make<ReadonlyMap<string, Cached<PullNode>>>(new Map())
  const issueCache = yield* Ref.make<ReadonlyMap<string, Cached<typeof IssueNode.Type>>>(new Map())
  const mentionBriefs = yield* Ref.make<ReadonlyMap<string, ReadonlyArray<Brief>>>(new Map())
  const listed = yield* Ref.make<ReadonlyMap<string, Kept<PullFacts>>>(new Map())
  const issuesRead = yield* Ref.make<ReadonlyMap<string, Kept<IssueFacts>>>(new Map())
  const probes = yield* Ref.make<ReadonlyMap<string, Probe>>(new Map())
  const rate = yield* Ref.make<RateLimit | null>(null)

  const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis)

  const backOff = Effect.fnUntraced(function* (reason: string, until: number | null) {
    const now = yield* nowMillis
    const count = yield* Ref.updateAndGet(strikes, (before) => before + 1)
    const resume = resumeAt(until, count, now)
    yield* Ref.set(pausedUntil, resume)
    yield* Ref.set(pauseReason, reason)
    yield* Effect.logWarning(
      `${reason} (refusal ${count} in a row); every desk and gh on the account share its limits. No GitHub calls until ${isoOf(resume)}.`
    )

    return yield* pausedError(reason, resume)
  })

  const notPaused = Effect.gen(function* () {
    const until = yield* Ref.get(pausedUntil)
    const now = yield* nowMillis
    if (now >= until) return
    const reason = yield* Ref.get(pauseReason)

    return yield* pausedError(reason, until)
  })

  const serially = <A, E>(call: Effect.Effect<A, E>) => gate.withPermits(1)(Effect.andThen(notPaused, call))

  const exchange = (request: HttpClientRequest.HttpClientRequest) =>
    request.pipe(
      raw.execute,
      Effect.flatMap((response) => Effect.map(response.text, (text) => ({ response, text }))),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

  const graphql = Effect.fnUntraced(function* <S extends Schema.Top>(body: object, data: S) {
    const { response, text } = yield* serially(
      exchange(HttpClientRequest.post("/graphql").pipe(HttpClientRequest.bodyJsonUnsafe(body))).pipe(
        Effect.tap(() => Effect.sleep(gap))
      )
    )
    const now = yield* nowMillis
    const verdict = verdictOf(answerOf(response, text), now)
    if (verdict._tag === "Throttled") return yield* backOff(verdict.reason, verdict.until)
    if (verdict._tag === "Failed") return yield* failed({ message: verdict.reason })
    yield* Ref.set(strikes, 0)

    return yield* Schema.decodeUnknownEffect(data)(verdict.data).pipe(Effect.mapError(failed))
  })

  const generationOf = Effect.fnUntraced(function* (repo: RepoSlug) {
    const now = yield* nowMillis
    const known = (yield* Ref.get(probes)).get(repo)
    if (known !== undefined && now - known.at < pollSeconds * 500) return known.generation
    const { response, text } = yield* serially(exchange(changeProbe(repo, known)))
    const refusal = refusalOf(answerOf(response, text), now)
    if (refusal !== null) return yield* backOff(refusal.reason, refusal.until)
    const unchanged = response.status === 304
    const previous = known?.generation ?? 0
    const generation = unchanged ? previous : previous + 1
    const fresh = response.status < 300 ? Option.getOrElse(Headers.get(response.headers, "etag"), () => "") : ""
    const etag = unchanged ? (known?.etag ?? "") : fresh
    yield* Ref.update(probes, (before) => new Map([...before, [repo, { etag, generation, at: now }]]))

    return generation
  })

  const stopUntilReset = Effect.gen(function* () {
    const current = yield* Ref.get(rate)
    const until = current === null ? 0 : millisOf(current.resetAt)
    const reason = "GitHub's rate limit for this account is nearly spent"
    yield* Ref.set(pausedUntil, until)
    yield* Ref.set(pauseReason, reason)
    yield* Effect.logWarning(
      `${reason}; every desk and gh on the account share it. No GitHub calls until ${isoOf(until)}.`
    )

    return yield* pausedError(reason, until)
  })

  const detailsOf = (ids: ReadonlyArray<string>) =>
    Effect.forEach(chunksOf(ids, detailBatch), (batch) =>
      graphql({ query: DETAIL_QUERY, variables: { ids: batch } }, DetailData)
    ).pipe(
      Effect.map(
        (answers) =>
          new Map(
            answers
              .flatMap((answer) => answer.nodes)
              .flatMap((node) => (node === null ? [] : [[node.id, node] as const]))
          )
      )
    )

  const list = Effect.fn("GitHub.list")(function* (repo: RepoSlug) {
    const found = yield* graphql({ query: LIST_QUERY, variables: searchesFor(repo, intakeLabel, login) }, ListData)
    yield* Ref.set(rate, found.rateLimit)
    yield* Ref.update(
      mentionBriefs,
      (before) =>
        new Map([
          ...before,
          [repo, found.mentioned.nodes.filter(isIssueBrief).map((node) => ({ ...node, checks: null }))]
        ])
    )
    const briefs = uniqueById(
      [
        ...found.involved.nodes,
        ...found.requested.nodes,
        ...found.reviewed.nodes,
        ...found.labelled.nodes,
        ...found.merged.nodes
      ].map(briefOf)
    )
    const known = yield* Ref.get(cache)
    const fresh = yield* detailsOf(changedIds(briefs, known))
    const current = new Map(
      briefs.flatMap((brief) => {
        const node = fresh.get(brief.id) ?? known.get(brief.id)?.node
        return node === undefined ? [] : [[brief.id, { stamp: stampOf(brief), node }] as const]
      })
    )
    yield* Ref.update(cache, (before) => new Map([...before, ...current]))

    return [...current.values()].map((entry) => factsOf(repo, entry.node))
  })

  const pulls = Effect.fn("GitHub.pulls")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    yield* notPaused
    const now = yield* nowMillis
    const reading = yield* Ref.get(rate)
    const pace = paceOf(currentRate(reading, now))
    if (pace === "stop") return yield* stopUntilReset
    const last = (yield* Ref.get(listed)).get(repo)
    if (last !== undefined && !listDue(pace, last.reading.at, now, pollSeconds * 1000)) return last.facts
    const generation = yield* generationOf(repo)
    if (!readDue({ generation, last: last?.reading, nowMillis: now, safetyMillis })) return last?.facts ?? []
    const facts = yield* list(repo)
    const kept = { reading: { generation, at: now, pending: facts.some(isPending) }, facts }
    yield* Ref.update(listed, (before) => new Map([...before, [repo, kept]]))

    return facts
  })

  const mentions = Effect.fn("GitHub.mentions")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const listedMentions = yield* Ref.get(mentionBriefs)
    const briefs = listedMentions.get(repo) ?? []
    const known = yield* Ref.get(issueCache)
    const changed = changedIds(briefs, known)
    const answers = yield* Effect.forEach(chunksOf(changed, detailBatch), (batch) =>
      graphql({ query: MENTION_QUERY, variables: { ids: batch } }, MentionData)
    )
    const fresh = new Map(
      answers.flatMap((answer) => answer.nodes).flatMap((node) => (node === null ? [] : [[node.id, node] as const]))
    )
    const current = new Map(
      briefs.flatMap((brief) => {
        const node = fresh.get(brief.id) ?? known.get(brief.id)?.node
        return node === undefined ? [] : [[brief.id, { stamp: stampOf(brief), node }] as const]
      })
    )
    yield* Ref.update(issueCache, (before) => new Map([...before, ...current]))

    return [...current.values()].map((entry) => issueOf(repo)(entry.node))
  })

  const budget = Effect.gen(function* () {
    const now = yield* nowMillis
    const reading = yield* Ref.get(rate)

    return budgetOf(currentRate(reading, now))
  })

  const post = Effect.fn("GitHub.post")(function* (pull: PullFacts, input: Post) {
    yield* Effect.annotateCurrentSpan("pull", pull.key)
    const created = yield* requestFor(pull, input).pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

    return created.html_url
  })

  const send = <S extends Schema.Top>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
    request.pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

  const issues = Effect.fn("GitHub.issues")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const now = yield* nowMillis
    const last = (yield* Ref.get(issuesRead)).get(repo)
    const generation = yield* generationOf(repo)
    if (!readDue({ generation, last: last?.reading, nowMillis: now, safetyMillis })) return last?.facts ?? []
    const [owner, name] = repo.split("/")
    const found = yield* graphql({ query: ISSUES_QUERY, variables: { owner, name } }, IssuesData)
    const facts = (found.repository?.issues.nodes ?? []).map(issueOf(repo))
    const kept = { reading: { generation, at: now, pending: false }, facts }
    yield* Ref.update(issuesRead, (before) => new Map([...before, [repo, kept]]))

    return facts
  })

  const commentOnIssue = Effect.fn("GitHub.commentOnIssue")(function* (repo: RepoSlug, number: number, body: string) {
    const created = yield* send(
      HttpClientRequest.post(`/repos/${repo}/issues/${number}/comments`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ body })
      ),
      Created
    )

    return created.html_url
  })

  const closeIssue = Effect.fn("GitHub.closeIssue")(function* (repo: RepoSlug, number: number) {
    yield* send(
      HttpClientRequest.patch(`/repos/${repo}/issues/${number}`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ state: "closed" })
      ),
      Schema.Struct({ state: Schema.String })
    )
  })

  return { pulls, post, issues, mentions, budget, commentOnIssue, closeIssue } satisfies ForgeClient
})
