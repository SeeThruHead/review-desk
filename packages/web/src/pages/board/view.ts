import type { Card } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Alert } from "../../components/Alert.ts"
import { Connecting } from "../../components/Connecting.ts"
import { DeskHeader } from "../../components/DeskHeader.ts"
import { DeskLayout } from "../../components/DeskLayout.ts"
import { PullCard } from "../../components/PullCard.ts"
import { PullList } from "../../components/PullRow.ts"
import { ReadyQueue, VerdictGroup } from "../../components/ReadyQueue.ts"
import { Section } from "../../components/Section.ts"
import type * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import { ui } from "../../theme/ui.ts"
import { Message } from "./message.ts"
import { appTheme } from "../../theme/theme.ts"
import { type Model, type SectionName, polledText, readyCount, readyGroups, sectionsOf, workingCount } from "./model.ts"

const sectionText: { readonly [S in SectionName]: { readonly title: string; readonly hint: string } } = {
  working: { title: "Agents working now", hint: "An agent is reviewing or fixing these right now" },
  queue: { title: "In the queue", hint: "Waiting on a person, the other side's agent or a review request" },
  history: { title: "History", hint: "Reviewed by a person, or merged" }
}

const alerts = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...(model.connection === "lost"
    ? [Alert(h, { tone: "warning", text: "Lost the connection to your desk. Showing the last board; reconnecting." })]
    : []),
  ...(model.notice === null
    ? []
    : [Alert(h, { tone: "error", text: model.notice, onDismiss: Message.DismissedNotice() })])
]

const rows = (model: Model, h: HtmlBuilder<Message>, id: SectionName, cards: ReadonlyArray<Card>, sidediff: boolean) =>
  cards.length === 0
    ? []
    : [
        PullList(h, {
          id,
          cards,
          expanded: model.expanded,
          sidediff,
          onChange: (shown, open) => Message.ChangedOpenPulls({ shown, open }),
          onOpenInSidediff: (key) => Message.ClickedOpenInSidediff({ key })
        })
      ]

const deskView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const board = model.board
  const sidebarScroll = {
    model: model.sidebar,
    toParentMessage: (message: ScrollArea.Message) => Message.GotSidebarScroll({ message })
  }

  if (board === null)
    return DeskLayout(h, {
      header: DeskHeader(h, { desk: "", ready: 0, working: 0, polled: "Not checked yet" }),
      alerts: alerts(model, h),
      main: [Connecting(h)],
      sidebar: ReadyQueue(h, { count: 0, children: [] }),
      sidebarScroll
    })

  return DeskLayout(h, {
    sidebarScroll,
    header: DeskHeader(h, {
      desk: board.desk,
      ready: readyCount(board),
      working: workingCount(board),
      polled: polledText(board)
    }),
    alerts: alerts(model, h),
    main: sectionsOf(board).map((section) =>
      Section(h, {
        title: sectionText[section.section].title,
        hint: sectionText[section.section].hint,
        count: section.cards.length,
        children: rows(model, h, section.section, section.cards, board.sidediff)
      })
    ),
    sidebar: ReadyQueue(h, {
      count: readyCount(board),
      children: readyGroups(board).map((group) =>
        VerdictGroup(h, {
          verdict: group.verdict,
          children: group.cards.map((card) =>
            PullCard(h, {
              card,
              sidediff: board.sidediff,
              onOpenInSidediff: Message.ClickedOpenInSidediff({ key: card.key }),
              settledOpen: model.settledOpen.includes(card.key),
              onSettledChange: (open) => Message.ToggledSettled({ key: card.key, open })
            })
          )
        })
      )
    })
  })
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  ui.ThemeProvider(h, { ...appTheme, colorScheme: "auto", children: [deskView(model, h)] })
