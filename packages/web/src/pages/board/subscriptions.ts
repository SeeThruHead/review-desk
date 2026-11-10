import { Duration, Effect, Option, Schedule, Stream } from "effect"
import * as ScrollAreaView from "@seethruhead/sth-ui/core/components/ScrollArea/ScrollArea.ts"
import * as Subscription from "foldkit/subscription"
import { DeskClient, DeskOffline } from "./client.ts"
import { Message } from "./message.ts"
import type { Model } from "./model.ts"

const boardOnce = Stream.unwrap(
  Effect.gen(function* () {
    const desk = yield* DeskClient

    return desk.watchBoard.pipe(Stream.map((board) => Message.ReceivedBoard({ board })))
  })
).pipe(
  Stream.concat(Stream.fail(new DeskOffline())),
  Stream.orElseSucceed(() => Message.LostConnection())
)

export const boardMessages: Stream.Stream<Message, never, DeskClient> = boardOnce.pipe(
  Stream.repeat(Schedule.spaced(Duration.seconds(3)))
)

const board = Subscription.make<Model, Message, DeskClient>()((entry) => ({
  board: entry({}, { modelToDependencies: () => ({}), dependenciesToStream: () => boardMessages })
}))

const sidebar = Subscription.lift(ScrollAreaView.subscriptions)<Model, Message>({
  read: (model) => Option.some(model.sidebar),
  toParentMessage: (message) => Message.GotSidebarScroll({ message })
})

export const subscriptions = Subscription.aggregate(board, sidebar)
