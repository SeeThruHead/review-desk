import type { Card, Stage } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"
import { AgentStatus } from "./AgentStatus.ts"
import { ChecksBadge } from "./Checks.ts"
import { RelationList } from "./Relations.ts"
import { RoundBadge } from "./Round.ts"
import { SettledList } from "./Settled.ts"
import { VerdictBadge } from "./Verdict.ts"

export type PullCardProps<M> = {
  readonly card: Card
  readonly sidediff: boolean
  readonly onOpenInSidediff: M
  readonly settledOpen: boolean
  readonly onSettledChange: (open: boolean) => M
}

const forgeName = { github: "GitHub", gitea: "Gitea" } as const

const agentStages: ReadonlySet<Stage> = new Set(["waiting", "requested", "reviewing", "talking"])

const showsAgent = (card: Card): boolean => card.trusted && agentStages.has(card.stage)

const threadsText = (count: number): string => (count === 1 ? "1 open thread" : `${count} open threads`)

const Heading = <M>(h: HtmlBuilder<M>, card: Card): Html =>
  ui.Group(h, {
    gap: 6,
    justify: "space-between",
    children: [
      ui.Text(h, { size: "xs", c: "dimmed", ff: "monospace", children: [`${card.repo}#${card.number}`] }),
      ui.Group(h, {
        gap: 6,
        children: [
          ...(card.checks === "none" ? [] : [ChecksBadge(h, { checks: card.checks })]),
          ui.Badge(h, {
            size: "sm",
            variant: "default",
            children: [card.role === "author" ? "Your PR" : "You're reviewing"]
          })
        ]
      })
    ]
  })

const triageParts = <M>(h: HtmlBuilder<M>, card: Card): ReadonlyArray<Html> =>
  card.triage === null
    ? []
    : [
        ui.Stack(h, {
          gap: 6,
          align: "flex-start",
          children: [
            VerdictBadge(h, { verdict: card.triage.verdict }),
            ui.Text(h, { size: "sm", children: [card.triage.reason] })
          ]
        })
      ]

const progressParts = <M>(h: HtmlBuilder<M>, card: Card): ReadonlyArray<Html> => {
  const parts = [
    ...(card.round === null ? [] : [RoundBadge(h, { round: card.round })]),
    ...(card.openThreads === 0 ? [] : [ui.Text(h, { size: "sm", fw: 500, children: [threadsText(card.openThreads)] })])
  ]

  return parts.length === 0 ? [] : [ui.Group(h, { gap: "sm", children: parts })]
}

const Actions = <M>(h: HtmlBuilder<M>, props: PullCardProps<M>): Html =>
  ui.Group(h, {
    gap: "sm",
    children: [
      ui.Anchor(h, {
        href: props.card.url,
        target: "_blank",
        rel: "noreferrer",
        size: "sm",
        children: [`Open on ${forgeName[props.card.forge]}`]
      }),
      ...(props.sidediff
        ? [
            ui.Button(h, {
              size: "xs",
              variant: "light",
              onClick: props.onOpenInSidediff,
              children: ["Open in sidediff"]
            })
          ]
        : [])
    ]
  })

export const PullCard = <M>(h: HtmlBuilder<M>, props: PullCardProps<M>): Html => {
  const card = props.card

  return ui.Card(h, {
    component: "article",
    withBorder: true,
    radius: "md",
    padding: "md",
    attributes: { root: { "aria-label": card.title } },
    children: [
      ui.Stack(h, {
        gap: "sm",
        children: [
          Heading(h, card),
          ui.Stack(h, {
            gap: 2,
            children: [
              ui.Text(h, { fw: 600, lh: 1.35, children: [card.title] }),
              ui.Text(h, { size: "sm", c: "dimmed", children: [`by ${card.author}`] })
            ]
          }),
          ...(card.trusted
            ? []
            : [ui.Text(h, { size: "sm", c: "red", fw: 600, children: ["Untrusted: never sent to an agent"] })]),
          ...triageParts(h, card),
          ...progressParts(h, card),
          ...(showsAgent(card) ? [AgentStatus(h, { agent: card.agent })] : []),
          ...(card.settled.length === 0
            ? []
            : [
                SettledList(h, {
                  id: `settled-${card.key.replace(/[^A-Za-z0-9]+/g, "-")}`,
                  settled: card.settled,
                  open: props.settledOpen,
                  onChange: props.onSettledChange
                })
              ]),
          ...(card.relations.length === 0 ? [] : [RelationList(h, { relations: card.relations })]),
          Actions(h, props)
        ]
      })
    ]
  })
}
