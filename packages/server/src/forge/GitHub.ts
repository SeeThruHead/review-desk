import type { Checks } from "@review-desk/contract/Board.ts"
import { IsoTime, Login, PrNumber, type RepoSlug, Text, Url, prKey } from "@review-desk/contract/Ids.ts"
import { Branch, ForgeId, type IssueFacts, type PullFacts } from "@review-desk/domain/Facts.ts"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { type ForgeClient, ForgeError, type Post } from "./Forge.ts"
import { searchesFor, uniqueByNumber } from "./GitHubSearch.ts"

const Author = Schema.NullOr(Schema.Struct({ login: Schema.String }))
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
  updatedAt: Schema.String,
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

const Response = Schema.Struct({
  data: Schema.Struct({
    involved: Nodes(PullNode),
    requested: Nodes(PullNode),
    reviewed: Nodes(PullNode),
    labelled: Nodes(PullNode),
    merged: Nodes(PullNode)
  })
})

const PULL_FIELDS = `fragment Pull on PullRequest {
    number title body url state isDraft mergeable updatedAt headRefName baseRefName headRefOid
    author { login }
    labels(first: 20) { nodes { name } }
    reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
    files(first: 100) { nodes { path } }
    latest: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    reviews(last: 50) { nodes { databaseId state body submittedAt url author { login } } }
    comments(last: 50) { nodes { databaseId body createdAt url author { login } } }
    reviewThreads(last: 50) { nodes { isResolved path line comments(first: 30) { nodes { databaseId body createdAt url author { login } } } } }
}`

const QUERY = `query($involved: String!, $requested: String!, $reviewed: String!, $labelled: String!, $merged: String!) {
  involved: search(query: $involved, type: ISSUE, first: 30) { nodes { ...Pull } }
  requested: search(query: $requested, type: ISSUE, first: 30) { nodes { ...Pull } }
  reviewed: search(query: $reviewed, type: ISSUE, first: 30) { nodes { ...Pull } }
  labelled: search(query: $labelled, type: ISSUE, first: 30) { nodes { ...Pull } }
  merged: search(query: $merged, type: ISSUE, first: 10) { nodes { ...Pull } }
}
${PULL_FIELDS}`

const loginOf = (author: typeof Author.Type): Login => Login.make(author?.login.replace(/\[bot\]$/, "") ?? "ghost")

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
  url: Url.make(node.url)
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
  reviews: node.reviews.nodes.map((review) => ({
    id: ForgeId.make(String(review.databaseId)),
    author: loginOf(review.author),
    state: reviewState(review.state),
    body: Text.make(review.body),
    at: IsoTime.make(review.submittedAt ?? node.updatedAt),
    url: Url.make(review.url)
  })),
  threads: node.reviewThreads.nodes.map((thread) => ({
    id: ForgeId.make(String(thread.comments.nodes[0]?.databaseId ?? `${thread.path}:${thread.line}`)),
    path: Text.make(thread.path),
    line: thread.line,
    resolved: thread.isResolved,
    comments: thread.comments.nodes.map(comment)
  })),
  comments: node.comments.nodes.map(comment),
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
  author: Author,
  comments: Nodes(CommentNode)
})

const IssuesResponse = Schema.Struct({
  data: Schema.Struct({ repository: Schema.NullOr(Schema.Struct({ issues: Nodes(IssueNode) })) })
})

const ISSUES_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    issues(states: [OPEN], first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number databaseId title body url createdAt author { login }
        comments(last: 50) { nodes { databaseId body createdAt url author { login } } }
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
    comments: node.comments.nodes.map(comment)
  })

const failed = (error: { readonly message: string }) => new ForgeError({ forge: "github", reason: error.message })

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

export const gitHubClient = Effect.fnUntraced(function* (api: string, token: string, intakeLabel: string) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(api),
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("user-agent", "review-desk"),
        HttpClientRequest.setHeader("accept", "application/vnd.github+json")
      )
    ),
    HttpClient.filterStatusOk
  )

  const pulls = Effect.fn("GitHub.pulls")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const response = yield* HttpClientRequest.post("/graphql").pipe(
      HttpClientRequest.bodyJsonUnsafe({ query: QUERY, variables: searchesFor(repo, intakeLabel) }),
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

    const found = response.data

    return uniqueByNumber([
      ...found.involved.nodes,
      ...found.requested.nodes,
      ...found.reviewed.nodes,
      ...found.labelled.nodes,
      ...found.merged.nodes
    ]).map((node) => factsOf(repo, node))
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
    const [owner, name] = repo.split("/")
    const response = yield* send(
      HttpClientRequest.post("/graphql").pipe(
        HttpClientRequest.bodyJsonUnsafe({ query: ISSUES_QUERY, variables: { owner, name } })
      ),
      IssuesResponse
    )

    return (response.data.repository?.issues.nodes ?? []).map(issueOf(repo))
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

  return { pulls, post, issues, commentOnIssue, closeIssue } satisfies ForgeClient
})
