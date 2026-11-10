import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Config, Duration, Effect, Layer, Redacted, Schedule, Schema, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse, HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import query from "../query.graphql" with { type: "text" }
import { DeskRpcs, type Snapshot } from "./Api.ts"
import appCss from "./dist/assets/stylex.css" with { type: "text" }
import appJs from "./dist/app.bundle" with { type: "text" }

const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }))
const Comment = Schema.Struct({ id: Schema.String, createdAt: Schema.String, body: Schema.String, url: Schema.String, author: Login })
const Nodes = <S extends Schema.Top>(item: S) => Schema.Struct({ nodes: Schema.Array(item) })

const Pull = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  headRefName: Schema.String,
  isDraft: Schema.Boolean,
  updatedAt: Schema.String,
  repository: Schema.Struct({ nameWithOwner: Schema.String }),
  author: Login,
  reviews: Nodes(Schema.Struct({ id: Schema.String, state: Schema.String, body: Schema.String, url: Schema.String, author: Login })),
  comments: Nodes(Comment),
  reviewThreads: Nodes(Schema.Struct({ path: Schema.String, isResolved: Schema.Boolean, comments: Nodes(Comment) }))
})

const SearchResponse = Schema.Struct({
  data: Schema.Struct({
    viewer: Schema.Struct({ login: Schema.String }),
    search: Nodes(Schema.Union([Pull, Schema.Struct({})]))
  })
})

const isPull = Schema.is(Pull)

const page = `<!doctype html><html><head><meta charset="utf-8"><title>Review Desk spike</title><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`

const Desk = Effect.gen(function* () {
  const token = yield* Config.Redacted("GITHUB_TOKEN")
  const every = yield* Config.Int("POLL_MS").pipe(Config.withDefault(60_000))
  const endpoint = yield* Config.String("GITHUB_GRAPHQL_URL").pipe(Config.withDefault("https://api.github.com/graphql"))
  const client = yield* HttpClient.HttpClient
  const state = yield* SubscriptionRef.make<Snapshot>({ polls: 0, pulls: [] })

  const poll = HttpClientRequest.post(endpoint).pipe(
    HttpClientRequest.bearerToken(Redacted.value(token)),
    HttpClientRequest.setHeader("user-agent", "review-desk-spike"),
    HttpClientRequest.bodyJsonUnsafe({ query }),
    client.execute,
    Effect.flatMap(HttpClientResponse.schemaBodyJson(SearchResponse)),
    Effect.timeout(Duration.seconds(30)),
    Effect.flatMap((response) =>
      SubscriptionRef.update(state, (previous) => ({
        polls: previous.polls + 1,
        pulls: response.data.search.nodes.filter(isPull).map((pull) => ({
          repo: pull.repository.nameWithOwner,
          number: pull.number,
          title: pull.title,
          url: pull.url,
          comments: pull.comments.nodes.length + pull.reviewThreads.nodes.length
        }))
      }))
    ),
    Effect.catch((error) => Effect.logWarning("poll failed", error))
  )

  yield* Effect.forkScoped(Effect.repeat(poll, Schedule.spaced(Duration.millis(every))))

  return Stream.concat(Stream.fromEffect(SubscriptionRef.get(state)), SubscriptionRef.changes(state))
})

const Handlers = DeskRpcs.toLayer(Effect.map(Desk, (watch) => ({ Watch: () => watch })))

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.html(page)),
  HttpRouter.add("GET", "/app.js", HttpServerResponse.text(appJs, { contentType: "text/javascript" })),
  HttpRouter.add("GET", "/app.css", HttpServerResponse.text(appCss, { contentType: "text/css" })),
  RpcServer.layerHttp({ group: DeskRpcs, path: "/rpc", protocol: "http" }).pipe(Layer.provide(Handlers))
)

const port = Number(process.env["PORT"] ?? "4710")

HttpRouter.serve(Routes).pipe(
  Layer.provide(RpcSerialization.layerNdjson),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(BunHttpServer.layer({ port })),
  Layer.launch,
  BunRuntime.runMain
)
