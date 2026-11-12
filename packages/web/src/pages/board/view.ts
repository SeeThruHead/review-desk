import type { Board, Card } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { Alert } from "../../components/Alert.ts"
import { Connecting } from "../../components/Connecting.ts"
import { DeskHeader } from "../../components/DeskHeader.ts"
import { DeskLayout } from "../../components/DeskLayout.ts"
import { MentionList } from "../../components/MentionList.ts"
import { NeedList } from "../../components/NeedList.ts"
import { PullCard } from "../../components/PullCard.ts"
import { PullList } from "../../components/PullRow.ts"
import { ReadyQueue, VerdictGroup } from "../../components/ReadyQueue.ts"
import { Section } from "../../components/Section.ts"
import type * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import { ui } from "../../theme/ui.ts"
import { Message } from "./message.ts"
import { appTheme } from "../../theme/theme.ts"
import {
  type Model,
  type SectionName,
  budgetText,
  healthText,
  mentionsOf,
  needsCount,
  otherNeeds,
  polledText,
  readyGroups,
  routingText,
  sectionsOf,
  timeOf,
  workingCount
} from "./model.ts"

const sectionText: { readonly [S in SectionName]: { readonly title: string; readonly hint: string } } = {
  reviewing: { title: "Reviewing", hint: "Review requested of you, or claimed by a reviewer agent" },
  mine: { title: "Your pull requests", hint: "What they wait on, CI, approvals and the merge queue" },
  history: { title: "History", hint: "Reviewed by a person, or merged" }
}

const boardAlerts = (board: Board | null, h: HtmlBuilder<Message>): ReadonlyArray<Html> => {
  if (board === null) return []
  const health = healthText(board)
  const routing = routingText(board)

  return [
    ...(health === null ? [] : [Alert(h, { tone: "warning", text: health })]),
    ...(routing === null ? [] : [Alert(h, { tone: "info", text: routing })])
  ]
}

const alerts = (model: Model, h: HtmlBuilder<Message>): ReadonlyArray<Html> => [
  ...(model.connection === "lost"
    ? [Alert(h, { tone: "warning", text: "Lost the connection to your desk. Showing the last board; reconnecting." })]
    : []),
  ...boardAlerts(model.board, h),
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
          time: timeOf,
          onChange: (shown, open) => Message.ChangedOpenPulls({ shown, open }),
          onOpenInSidediff: (key) => Message.ClickedOpenInSidediff({ key })
        })
      ]

const onSeen = (key: Card["key"]) => Message.ClickedSeen({ key })

const mentionSection = (board: Board, h: HtmlBuilder<Message>): Html => {
  const mentions = mentionsOf(board)

  return Section(h, {
    title: "Mentions",
    hint: "Pull requests and issues in your repositories where someone @mentioned you",
    count: mentions.length,
    children: mentions.length === 0 ? [] : [MentionList(h, { mentions, time: timeOf, onSeen })]
  })
}

const sidebarOf = (model: Model, board: Board, h: HtmlBuilder<Message>): Html => {
  const others = otherNeeds(board)

  return ReadyQueue(h, {
    count: needsCount(board),
    children: [
      ...readyGroups(board).map((group) =>
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
      ),
      ...(others.length === 0 ? [] : [NeedList(h, { needs: others, onSeen })])
    ]
  })
}

const deskView = (model: Model, h: HtmlBuilder<Message>): Html => {
  const board = model.board
  const sidebarScroll = {
    model: model.sidebar,
    toParentMessage: (message: ScrollArea.Message) => Message.GotSidebarScroll({ message })
  }

  if (board === null)
    return DeskLayout(h, {
      header: DeskHeader(h, { desk: "", needs: 0, working: 0, polled: "Not checked yet", budget: null }),
      alerts: alerts(model, h),
      main: [Connecting(h)],
      sidebar: ReadyQueue(h, { count: 0, children: [] }),
      sidebarScroll
    })

  const lanes = sectionsOf(board).map((section) => ({
    name: section.section,
    html: Section(h, {
      title: sectionText[section.section].title,
      hint: sectionText[section.section].hint,
      count: section.cards.length,
      children: rows(model, h, section.section, section.cards, board.sidediff)
    })
  }))
  const lane = (name: SectionName) => lanes.filter((entry) => entry.name === name).map((entry) => entry.html)

  return DeskLayout(h, {
    sidebarScroll,
    header: DeskHeader(h, {
      desk: board.desk,
      needs: needsCount(board),
      working: workingCount(board),
      polled: polledText(board),
      budget: budgetText(board)
    }),
    alerts: alerts(model, h),
    main: [...lane("reviewing"), ...lane("mine"), mentionSection(board, h), ...lane("history")],
    sidebar: sidebarOf(model, board, h)
  })
}

export const view = (model: Model, h: HtmlBuilder<Message>): Html =>
  ui.ThemeProvider(h, { ...appTheme, colorScheme: "auto", children: [deskView(model, h)] })
