import { Board } from "@review-desk/contract/Board.ts"
import { PrKey, Text } from "@review-desk/contract/Ids.ts"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"

export const Message = defineMessageUnion({
  ReceivedBoard: { board: Board },
  LostConnection: {},
  ClickedOpenInSidediff: { key: PrKey },
  OpenedInSidediff: {},
  FailedToOpenInSidediff: { reason: Text },
  DismissedNotice: {},
  ChangedOpenPulls: { shown: Schema.Array(PrKey), open: Schema.Array(PrKey) },
  ToggledSettled: { key: PrKey, open: Schema.Boolean },
  ClickedSeen: { key: PrKey },
  MarkedSeen: {},
  FailedToMarkSeen: { reason: Text },
  GotSidebarScroll: { message: ScrollArea.Message }
})
export type Message = typeof Message.Type
