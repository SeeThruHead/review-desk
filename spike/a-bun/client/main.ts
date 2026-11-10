import { createUi } from "@sth-ui/core/Ui.ts"
import { Effect, Layer, Schema, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { Runtime } from "foldkit"
import type { HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import * as Subscription from "foldkit/subscription"
import { DeskRpcs, Snapshot } from "../Api.ts"

const Model = Schema.Struct({ snapshot: Snapshot, live: Schema.Boolean })
type Model = typeof Model.Type

const Message = defineMessageUnion({ Received: { snapshot: Snapshot } })
type Message = typeof Message.Type

const ui = createUi({})

const Protocol = RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
  Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson])
)

const watch = Stream.unwrap(
  Effect.map(RpcClient.make(DeskRpcs), (client) => client.Watch())
).pipe(
  Stream.map((snapshot) => Message.Received({ snapshot })),
  Stream.provide(Protocol),
  Stream.catch(() => Stream.empty)
)

const subscriptions = Subscription.make<Model, Message>()((entry) => ({
  desk: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: () => watch })
}))

const view = (model: Model, h: HtmlBuilder<Message>) =>
  ui.ThemeProvider(h, {
    colorScheme: "auto",
    children: [
      ui.Stack(h, {
        p: "lg",
        maw: 900,
        children: [
          ui.Title(h, { order: 2, children: ["Ready for you"] }),
          ui.Text(h, { c: "dimmed", children: [`${model.snapshot.pulls.length} pull requests, ${model.snapshot.polls} polls`] }),
          ...model.snapshot.pulls.map((pull) =>
            ui.Card(h, {
              withBorder: true,
              children: [
                ui.Group(h, {
                  children: [
                    ui.Text(h, { fw: 600, children: [pull.title] }),
                    ui.Badge(h, { variant: "light", children: [`${pull.repo}#${pull.number}`] }),
                    ui.Badge(h, { color: "teal", children: [`${pull.comments} threads`] })
                  ]
                })
              ]
            })
          )
        ]
      })
    ]
  })

const container = document.getElementById("root")

if (container !== null) {
  Runtime.embed(
    Runtime.makeElement({
      Model,
      init: () => ({ model: { snapshot: { polls: 0, pulls: [] }, live: false } }),
      update: (model: Model, message: Message) =>
        Message.match(message, { Received: ({ snapshot }) => ({ model: { ...model, snapshot, live: true } }) }),
      subscriptions,
      view,
      container
    })
  )
}
