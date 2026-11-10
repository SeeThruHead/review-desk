import type { Card, Stage } from "@review-desk/contract/Board.ts"
import type { PrKey } from "@review-desk/contract/Ids.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
  type AccordionItem,
  accordionControl,
  accordionItem,
  accordionPanel
} from "@seethruhead/sth-ui/core/components/Accordion/Accordion.ts"
import { ui } from "../theme/ui.ts"
import { AgentStatus } from "./AgentStatus.ts"
import { ChecksBadge } from "./Checks.ts"
import { RelationList } from "./Relations.ts"
import { ThreadBoard } from "./ThreadBoard.ts"
import { VerdictBadge } from "./Verdict.ts"

export type PullListProps<M> = {
  readonly id: string
  readonly cards: ReadonlyArray<Card>
  readonly expanded: ReadonlyArray<PrKey>
  readonly sidediff: boolean
  readonly onChange: (shown: ReadonlyArray<PrKey>, open: ReadonlyArray<PrKey>) => M
  readonly onOpenInSidediff: (key: PrKey) => M
}

const forgeName = { github: "GitHub", gitea: "Gitea" } as const

const plainStatus: { readonly [S in Stage]: string } = {
  waiting: "Waiting for review",
  requested: "Review requested",
  reviewing: "Agent reviewing",
  talking: "Agents talking",
  ready: "Ready for you",
  reviewed: "Human reviewed",
  merged: "Merged"
}

export const statusText = (card: Card): string => {
  if (card.stage === "ready" && card.role === "author") return "Ready for their review"
  if (card.stage !== "talking" || card.round === null) return plainStatus[card.stage]
  const turn = card.round.turn === "mine" ? "your agent's turn" : "their agent's turn"

  return `Agents talking, round ${card.round.number} of ${card.round.limit}, ${turn}`
}

type State = { readonly label: string; readonly glyph: string; readonly color: string }

const stateOf = (card: Card): State => {
  if (card.stage === "merged" || card.stage === "reviewed") return { label: "Done", glyph: "✓", color: "blue" }
  if (card.agent?.working === true) return { label: "An agent is working on it", glyph: "▶▶", color: "green" }

  return { label: "Waiting", glyph: "❚❚", color: "dimmed" }
}

const Icon = <M>(h: HtmlBuilder<M>, card: Card): Html => {
  const state = stateOf(card)

  return ui.Text(h, {
    component: "span",
    size: "sm",
    c: state.color,
    w: 28,
    ta: "center",
    attributes: { root: { role: "img", "aria-label": state.label } },
    children: [state.glyph]
  })
}

const desktopOnly = { base: "none", sm: "flex" }

const Summary = <M>(h: HtmlBuilder<M>, card: Card): ReadonlyArray<Html> => [
  ui.Group(h, {
    wrap: "nowrap",
    gap: "md",
    children: [
      Icon(h, card),
      ui.Stack(h, {
        gap: 2,
        flex: 1,
        miw: 0,
        children: [
          ui.Text(h, {
            fw: 600,
            size: "sm",
            truncate: true,
            attributes: { root: { "data-title": "" } },
            children: [card.title]
          }),
          ui.Text(h, {
            size: "xs",
            c: "dimmed",
            truncate: true,
            children: [`${card.repo}#${card.number} by ${card.author}`]
          })
        ]
      }),
      ui.Text(h, { size: "sm", w: 300, display: desktopOnly, children: [statusText(card)] }),
      ui.Group(h, {
        gap: 6,
        wrap: "nowrap",
        justify: "flex-end",
        display: desktopOnly,
        children: [
          ...(card.trusted
            ? []
            : [ui.Badge(h, { size: "sm", color: "red", variant: "light", children: ["Untrusted"] })]),
          ...(card.agent === null
            ? []
            : [ui.Badge(h, { size: "sm", variant: "default", children: [card.agent.session] })]),
          ...(card.checks === "none" ? [] : [ChecksBadge(h, { checks: card.checks })])
        ]
      })
    ]
  })
]

const agentParts = <M>(h: HtmlBuilder<M>, card: Card): ReadonlyArray<Html> => {
  if (!card.trusted) return []
  if (card.stage === "merged") return []
  if (card.stage === "reviewed") return []

  return [AgentStatus(h, { agent: card.agent })]
}

const sideName = { reviewer: "The reviewer's agent said", author: "The author's agent said" } as const

const Details = <M>(h: HtmlBuilder<M>, card: Card, props: PullListProps<M>): ReadonlyArray<Html> => {
  const activity = card.activity ?? null

  return [
    ui.Stack(h, {
      gap: "md",
      children: [
        ...(card.trusted
          ? []
          : [ui.Text(h, { size: "sm", c: "red", fw: 600, children: ["Untrusted: never sent to an agent"] })]),
        ...agentParts(h, card),
        ...(activity === null
          ? []
          : [
              ui.Stack(h, {
                gap: 4,
                children: [
                  ui.Text(h, { size: "xs", c: "dimmed", children: [sideName[activity.side]] }),
                  ui.Blockquote(h, { color: "gray", p: "xs", fz: "sm", children: [activity.text] })
                ]
              })
            ]),
        ...(card.triage === null
          ? []
          : [
              ui.Group(h, {
                gap: "sm",
                children: [
                  VerdictBadge(h, { verdict: card.triage.verdict }),
                  ui.Text(h, { size: "sm", children: [card.triage.reason] })
                ]
              })
            ]),
        ThreadBoard(h, { threads: card.threads ?? [] }),
        ...(card.relations.length === 0 ? [] : [RelationList(h, { relations: card.relations })]),
        ui.Group(h, {
          gap: "sm",
          children: [
            ui.Anchor(h, {
              href: card.url,
              target: "_blank",
              rel: "noreferrer",
              size: "sm",
              children: [`Open on ${forgeName[card.forge]}`]
            }),
            ...(props.sidediff
              ? [
                  ui.Button(h, {
                    size: "xs",
                    variant: "light",
                    onClick: props.onOpenInSidediff(card.key),
                    children: ["Open in sidediff"]
                  })
                ]
              : [])
          ]
        })
      ]
    })
  ]
}

const pullItem = <M>(h: HtmlBuilder<M>, card: Card, props: PullListProps<M>): AccordionItem =>
  accordionItem({
    value: card.key,
    children: [accordionControl({ children: Summary(h, card) }), accordionPanel({ children: Details(h, card, props) })]
  })

export const PullList = <M>(h: HtmlBuilder<M>, props: PullListProps<M>): Html => {
  const shown = props.cards.map((card) => card.key)
  const open = shown.filter((key) => props.expanded.includes(key))

  return ui.Accordion(h, {
    id: props.id,
    variant: "contained",
    multiple: true,
    value: open,
    onChange: (after) =>
      props.onChange(
        shown,
        shown.filter((key) => after.includes(key))
      ),
    children: props.cards.map((card) => pullItem(h, card, props))
  })
}
