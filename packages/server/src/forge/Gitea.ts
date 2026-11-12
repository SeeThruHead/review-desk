import { IsoTime, Login, PrNumber, type RepoSlug, Text, Url, prKey } from "@review-desk/contract/Ids.ts"
import type { Run } from "@review-desk/domain/Branches.ts"
import {
  Branch,
  type Comment,
  ForgeId,
  type IssueFacts,
  type PullFacts,
  type Thread
} from "@review-desk/domain/Facts.ts"
import { Duration, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { ownedBy } from "../desk/Repos.ts"
import { type BranchRuns, type ForgeClient, ForgeError, type Post } from "./Forge.ts"

const User = Schema.NullOr(Schema.Struct({ login: Schema.String }))

const PullJson = Schema.Struct({
  number: Schema.Finite,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  state: Schema.Literals(["open", "closed"]),
  merged: Schema.Boolean,
  draft: Schema.optionalKey(Schema.Boolean),
  mergeable: Schema.Boolean,
  updated_at: Schema.String,
  user: User,
  head: Schema.Struct({ ref: Schema.String, sha: Schema.String }),
  base: Schema.Struct({ ref: Schema.String }),
  labels: Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String }))),
  requested_reviewers: Schema.NullOr(Schema.Array(Schema.Struct({ login: Schema.String })))
})
type PullJson = typeof PullJson.Type

const ReviewJson = Schema.Struct({
  id: Schema.Finite,
  state: Schema.String,
  body: Schema.String,
  submitted_at: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  user: User
})

const ReviewCommentJson = Schema.Struct({
  id: Schema.Finite,
  body: Schema.String,
  path: Schema.String,
  position: Schema.NullOr(Schema.Finite),
  created_at: Schema.String,
  html_url: Schema.String,
  user: User,
  resolver: Schema.optionalKey(Schema.NullOr(Schema.Struct({ login: Schema.String })))
})
type ReviewCommentJson = typeof ReviewCommentJson.Type

const IssueCommentJson = Schema.Struct({
  id: Schema.Finite,
  body: Schema.String,
  created_at: Schema.String,
  html_url: Schema.String,
  user: User
})

const FileJson = Schema.Struct({ filename: Schema.String })

const StatusJson = Schema.Struct({ state: Schema.String, total_count: Schema.Finite })

const IssueJson = Schema.Struct({
  number: Schema.Finite,
  id: Schema.Finite,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
  html_url: Schema.String,
  created_at: Schema.String,
  user: User
})

const RunJson = Schema.Struct({
  id: Schema.Int,
  path: Schema.String,
  display_title: Schema.String,
  html_url: Schema.String,
  status: Schema.String,
  conclusion: Schema.optionalKey(Schema.NullOr(Schema.String))
})

const RunsJson = Schema.Struct({ workflow_runs: Schema.NullOr(Schema.Array(RunJson)) })

const JobsJson = Schema.Struct({
  jobs: Schema.NullOr(Schema.Array(Schema.Struct({ name: Schema.String, conclusion: Schema.NullOr(Schema.String) })))
})

const outcomeOf = (conclusion: string | null): Run["outcome"] => {
  if (conclusion === "success") return "passed"
  if (conclusion === "failure") return "failed"

  return "other"
}

export const runOf = (run: typeof RunJson.Type): Run => ({
  id: run.id,
  workflow: Text.make(run.path.replace(/@.*$/, "")),
  title: Text.make(run.display_title),
  url: Url.make(run.html_url),
  done: run.status === "completed",
  outcome: outcomeOf(run.conclusion ?? null)
})

const loginOf = (user: typeof User.Type): Login => Login.make(user?.login ?? "ghost")

const reviewStates: Readonly<Record<string, "approved" | "changes_requested" | "commented" | "pending">> = {
  APPROVED: "approved",
  REQUEST_CHANGES: "changes_requested",
  PENDING: "pending"
}

const checksOf = (status: typeof StatusJson.Type) => {
  if (status.total_count === 0) return "none" as const
  if (status.state === "success") return "passed" as const
  if (status.state === "pending") return "pending" as const

  return "failed" as const
}

const threadKey = (comment: ReviewCommentJson) => `${comment.path}:${comment.position ?? 0}`

export const threadsOf = (comments: ReadonlyArray<ReviewCommentJson>): ReadonlyArray<Thread> =>
  [
    ...Map.groupBy(
      comments.toSorted((a, b) => a.id - b.id),
      threadKey
    ).values()
  ].flatMap((group) =>
    group[0] === undefined
      ? []
      : [
          {
            id: ForgeId.make(String(group[0].id)),
            path: Text.make(group[0].path),
            line: group[0].position,
            resolved: group.some((comment) => comment.resolver !== undefined && comment.resolver !== null),
            comments: group.map((comment): Comment => ({
              id: ForgeId.make(String(comment.id)),
              author: loginOf(comment.user),
              body: Text.make(comment.body),
              at: IsoTime.make(comment.created_at),
              url: Url.make(comment.html_url)
            }))
          }
        ]
  )

type Details = {
  readonly reviews: ReadonlyArray<typeof ReviewJson.Type>
  readonly reviewComments: ReadonlyArray<ReviewCommentJson>
  readonly comments: ReadonlyArray<typeof IssueCommentJson.Type>
  readonly files: ReadonlyArray<typeof FileJson.Type>
  readonly status: typeof StatusJson.Type
}

const noDetails: Details = {
  reviews: [],
  reviewComments: [],
  comments: [],
  files: [],
  status: { state: "", total_count: 0 }
}

export const factsOf = (repo: RepoSlug, pull: PullJson, details: Details): PullFacts => ({
  key: prKey("gitea", repo, PrNumber.make(pull.number)),
  forge: "gitea",
  repo,
  number: PrNumber.make(pull.number),
  title: Text.make(pull.title),
  body: Text.make(pull.body ?? ""),
  url: Url.make(pull.html_url),
  author: loginOf(pull.user),
  head: Branch.make(pull.head.ref),
  headSha: Text.make(pull.head.sha),
  base: Branch.make(pull.base.ref),
  draft: pull.draft ?? false,
  state: pull.merged ? "merged" : pull.state,
  labels: (pull.labels ?? []).map((label) => Text.make(label.name)),
  requested: (pull.requested_reviewers ?? []).map((reviewer) => Login.make(reviewer.login)),
  files: details.files.map((file) => Text.make(file.filename)),
  checks: checksOf(details.status),
  mergeable: pull.mergeable ? "yes" : "no",
  review: null,
  queue: null,
  reviews: details.reviews.map((review) => ({
    id: ForgeId.make(String(review.id)),
    author: loginOf(review.user),
    state: reviewStates[review.state] ?? "commented",
    body: Text.make(review.body),
    at: IsoTime.make(review.submitted_at ?? pull.updated_at),
    url: Url.make(review.html_url)
  })),
  threads: threadsOf(details.reviewComments),
  comments: details.comments.map((comment) => ({
    id: ForgeId.make(String(comment.id)),
    author: loginOf(comment.user),
    body: Text.make(comment.body),
    at: IsoTime.make(comment.created_at),
    url: Url.make(comment.html_url)
  })),
  updatedAt: IsoTime.make(pull.updated_at)
})

const failed = (error: { readonly message: string }) => new ForgeError({ forge: "gitea", reason: error.message })

export const giteaClient = Effect.fnUntraced(function* (url: string, token: string) {
  const http = (yield* HttpClient.HttpClient).pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(`${url}/api/v1`),
        HttpClientRequest.setHeader("authorization", `token ${token}`),
        HttpClientRequest.setHeader("user-agent", "review-desk")
      )
    ),
    HttpClient.filterStatusOk
  )

  const get = <S extends Schema.Top>(path: string, schema: S) =>
    HttpClientRequest.get(path).pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

  const detailsFor = Effect.fnUntraced(function* (repo: RepoSlug, pull: PullJson) {
    const base = `/repos/${repo}`
    const [reviews, comments, files, status] = yield* Effect.all(
      [
        get(`${base}/pulls/${pull.number}/reviews`, Schema.Array(ReviewJson)),
        get(`${base}/issues/${pull.number}/comments`, Schema.Array(IssueCommentJson)),
        get(`${base}/pulls/${pull.number}/files`, Schema.Array(FileJson)),
        get(`${base}/commits/${pull.head.sha}/status`, StatusJson)
      ],
      { concurrency: 4 }
    )
    const reviewComments = yield* Effect.forEach(
      reviews,
      (review) => get(`${base}/pulls/${pull.number}/reviews/${review.id}/comments`, Schema.Array(ReviewCommentJson)),
      {
        concurrency: 4
      }
    )

    return { reviews, reviewComments: reviewComments.flat(), comments, files, status } satisfies Details
  })

  const pulls = Effect.fn("Gitea.pulls")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const [open, closed] = yield* Effect.all(
      [
        get(`/repos/${repo}/pulls?state=open&sort=recentupdate&limit=50`, Schema.Array(PullJson)),
        get(`/repos/${repo}/pulls?state=closed&sort=recentupdate&limit=5`, Schema.Array(PullJson))
      ],
      { concurrency: 2 }
    )
    const detailed = yield* Effect.forEach(
      open,
      (pull) => Effect.map(detailsFor(repo, pull), (details) => factsOf(repo, pull, details)),
      { concurrency: 2 }
    )

    return [...detailed, ...closed.filter((pull) => pull.merged).map((pull) => factsOf(repo, pull, noDetails))]
  })

  const Created = Schema.Struct({ html_url: Schema.String })

  const post = Effect.fn("Gitea.post")(function* (pull: PullFacts, input: Post) {
    yield* Effect.annotateCurrentSpan("pull", pull.key)
    const request =
      input.path === null
        ? HttpClientRequest.post(`/repos/${pull.repo}/issues/${pull.number}/comments`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ body: input.body })
          )
        : HttpClientRequest.post(`/repos/${pull.repo}/pulls/${pull.number}/reviews`).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              event: "COMMENT",
              body: "",
              commit_id: pull.headSha,
              comments: [{ path: input.path, body: input.body, new_position: input.line ?? 1 }]
            })
          )
    const created = yield* request.pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Created)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

    return created.html_url
  })

  const runs = Effect.fn("Gitea.runs")(function* (repo: RepoSlug, branch: string) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const found = yield* get(`/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&limit=20`, RunsJson)

    return (found.workflow_runs ?? []).map(runOf)
  })

  const failedJobs = Effect.fn("Gitea.failedJobs")(function* (repo: RepoSlug, run: number) {
    const found = yield* get(`/repos/${repo}/actions/runs/${run}/jobs`, JobsJson)

    return (found.jobs ?? []).filter((job) => job.conclusion === "failure").map((job) => Text.make(job.name))
  })

  const issues = Effect.fn("Gitea.issues")(function* (repo: RepoSlug) {
    yield* Effect.annotateCurrentSpan("repo", repo)
    const open = yield* get(`/repos/${repo}/issues?type=issues&state=open&limit=50`, Schema.Array(IssueJson))

    return yield* Effect.forEach(
      open,
      (issue) =>
        Effect.map(
          get(`/repos/${repo}/issues/${issue.number}/comments`, Schema.Array(IssueCommentJson)),
          (comments): IssueFacts => ({
            forge: "gitea",
            repo,
            number: PrNumber.make(issue.number),
            id: ForgeId.make(String(issue.id)),
            title: Text.make(issue.title),
            body: Text.make(issue.body ?? ""),
            url: Url.make(issue.html_url),
            author: loginOf(issue.user),
            createdAt: IsoTime.make(issue.created_at),
            comments: comments.map((comment) => ({
              id: ForgeId.make(String(comment.id)),
              author: loginOf(comment.user),
              body: Text.make(comment.body),
              at: IsoTime.make(comment.created_at),
              url: Url.make(comment.html_url)
            }))
          })
        ),
      { concurrency: 2 }
    )
  })

  const send = <S extends Schema.Top>(request: HttpClientRequest.HttpClientRequest, schema: S) =>
    request.pipe(
      http.execute,
      Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
      Effect.timeout(Duration.seconds(30)),
      Effect.mapError(failed)
    )

  const commentOnIssue = Effect.fn("Gitea.commentOnIssue")(function* (repo: RepoSlug, number: number, body: string) {
    const created = yield* send(
      HttpClientRequest.post(`/repos/${repo}/issues/${number}/comments`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ body })
      ),
      Created
    )

    return created.html_url
  })

  const closeIssue = Effect.fn("Gitea.closeIssue")(function* (repo: RepoSlug, number: number) {
    yield* send(
      HttpClientRequest.patch(`/repos/${repo}/issues/${number}`).pipe(
        HttpClientRequest.bodyJsonUnsafe({ state: "closed" })
      ),
      Schema.Struct({ state: Schema.String })
    )
  })

  const RepoJson = Schema.Struct({
    full_name: Schema.String,
    owner: Schema.Struct({ login: Schema.String }),
    archived: Schema.Boolean
  })

  const reposPage = (page: number) => get(`/user/repos?limit=50&page=${page}`, Schema.Array(RepoJson))

  const ownedRepos = Effect.fn("Gitea.ownedRepos")(function* (logins: ReadonlyArray<string>) {
    const pages = yield* Effect.forEach([1, 2, 3, 4], reposPage, { concurrency: 2 })

    return ownedBy(pages.flat(), logins)
  })

  return {
    pulls,
    post,
    runs,
    failedJobs,
    issues,
    mentions: () => Effect.succeed([]),
    budget: Effect.succeed(null),
    commentOnIssue,
    closeIssue,
    ownedRepos
  } satisfies ForgeClient & BranchRuns
})
