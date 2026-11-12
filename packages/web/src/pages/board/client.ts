import type { Board } from "@review-desk/contract/Board.ts"
import { DeskRpcs, type NotConfigured, type SidediffFailed, type UnknownPull } from "@review-desk/contract/Contract.ts"
import type { PrKey } from "@review-desk/contract/Ids.ts"
import { Context, Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"

export class DeskOffline extends Schema.TaggedError<DeskOffline, { readonly brand: unique symbol }>()(
  "DeskOffline",
  {}
) {
  override get message() {
    return "Review Desk is not answering"
  }
}

export class DeskClient extends Context.Service<
  DeskClient,
  {
    readonly watchBoard: Stream.Stream<Board, DeskOffline>
    readonly openInSidediff: (
      key: PrKey
    ) => Effect.Effect<void, SidediffFailed | UnknownPull | NotConfigured | DeskOffline>
    readonly markSeen: (key: PrKey) => Effect.Effect<void, UnknownPull | DeskOffline>
  }
>()("review-desk/web/DeskClient") {
  static readonly layerNoDeps = Layer.effect(
    DeskClient,
    Effect.gen(function* () {
      const client = yield* RpcClient.make(DeskRpcs)

      return DeskClient.of({
        watchBoard: client.WatchBoard().pipe(Stream.mapError(() => new DeskOffline())),
        openInSidediff: (key) =>
          client.OpenInSidediff({ key }).pipe(Effect.catchTag("RpcClientError", () => Effect.fail(new DeskOffline()))),
        markSeen: (key) =>
          client.MarkSeen({ key }).pipe(Effect.catchTag("RpcClientError", () => Effect.fail(new DeskOffline())))
      })
    })
  )

  static readonly layer = DeskClient.layerNoDeps.pipe(
    Layer.provide(RpcClient.layerProtocolHttp({ url: "/rpc" })),
    Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
  )
}
