import * as Command from "foldkit/command"
import * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import type { DeskClient } from "./client.ts"
import { OpenInSidediff } from "./commands.ts"
import { Message } from "./message.ts"
import type { Model } from "./model.ts"

export type Update = {
  readonly model: Model
  readonly commands?: ReadonlyArray<Command.Command<Message, never, DeskClient>>
}

export const update = (model: Model, message: Message): Update =>
  Message.match(message, {
    ReceivedBoard: ({ board }) => ({ model: { ...model, connection: "live" as const, board } }),
    LostConnection: () => ({ model: { ...model, connection: "lost" as const } }),
    ClickedOpenInSidediff: ({ key }) => ({ model, commands: [OpenInSidediff({ key })] }),
    OpenedInSidediff: () => ({ model: { ...model, notice: null } }),
    FailedToOpenInSidediff: ({ reason }) => ({ model: { ...model, notice: reason } }),
    DismissedNotice: () => ({ model: { ...model, notice: null } }),
    GotSidebarScroll: ({ message: inner }) => {
      const scrolled = ScrollArea.update(model.sidebar, inner)

      return {
        model: { ...model, sidebar: scrolled.model },
        commands: scrolled.commands.map((command) =>
          Command.mapMessage(command, (lifted) => Message.GotSidebarScroll({ message: lifted }))
        )
      }
    },
    ToggledSettled: ({ key, open }) => ({
      model: { ...model, settledOpen: [...model.settledOpen.filter((other) => other !== key), ...(open ? [key] : [])] }
    }),
    ChangedOpenPulls: ({ shown, open }) => ({
      model: { ...model, expanded: [...model.expanded.filter((key) => !shown.includes(key)), ...open] }
    })
  })
