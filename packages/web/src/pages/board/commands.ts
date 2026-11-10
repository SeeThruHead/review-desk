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
