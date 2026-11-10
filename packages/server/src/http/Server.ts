import { BunHttpServer } from "@effect/platform-bun"
import { DeskRpcs } from "@review-desk/contract/Contract.ts"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import { DeskConfig } from "../config/DeskConfig.ts"
import { Handlers } from "../rpc/Handlers.ts"
import { asset, page } from "./Assets.ts"

const served = (suffix: string, devPath: string, contentType: string) =>
  asset(suffix, devPath).pipe(
    Effect.map((body) => HttpServerResponse.text(body, { contentType })),
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Not built yet: run bun run build in packages/web", { status: 404 })
    )
  )

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.html(page)),
  HttpRouter.add("GET", "/app.js", served("app.bundle", "app.bundle", "text/javascript")),
  HttpRouter.add("GET", "/app.css", served("stylex.css", "assets/stylex.css", "text/css")),
  RpcServer.layerHttp({ group: DeskRpcs, path: "/rpc", protocol: "http" }).pipe(Layer.provide(Handlers))
)

export const HttpLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* DeskConfig

    return HttpRouter.serve(Routes).pipe(
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(
        BunHttpServer.layer({ port: config.port, hostname: "127.0.0.1", gracefulShutdownTimeout: "1 second" })
      )
    )
  })
)
