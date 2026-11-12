import { PrKey, Text } from "@review-desk/contract/Ids.ts"
import { Effect } from "effect"
import * as Command from "foldkit/command"
import { DeskClient } from "./client.ts"
import { Message } from "./message.ts"

export const OpenInSidediff = Command.define("OpenInSidediff", {
  args: { key: PrKey },
  messages: [Message.OpenedInSidediff, Message.FailedToOpenInSidediff],
  execute: ({ key }) =>
    Effect.gen(function* () {
      const desk = yield* DeskClient
      yield* desk.openInSidediff(key)

      return Message.OpenedInSidediff()
    }).pipe(
      Effect.catch((error) => Effect.succeed(Message.FailedToOpenInSidediff({ reason: Text.make(error.message) })))
    )
})

export const MarkSeen = Command.define("MarkSeen", {
  args: { key: PrKey },
  messages: [Message.MarkedSeen, Message.FailedToMarkSeen],
  execute: ({ key }) =>
    Effect.gen(function* () {
      const desk = yield* DeskClient
      yield* desk.markSeen(key)

      return Message.MarkedSeen()
    }).pipe(Effect.catch((error) => Effect.succeed(Message.FailedToMarkSeen({ reason: Text.make(error.message) }))))
})
