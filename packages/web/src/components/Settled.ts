import type { Outcome, Settled } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import {
  accordionControl,
  accordionItem,
  accordionPanel
} from "@seethruhead/sth-ui/core/components/Accordion/Accordion.ts"
import { ui } from "../theme/ui.ts"
import { Nothing } from "./Nothing.ts"

export type SettledListProps<M> = {
  readonly id: string
  readonly settled: ReadonlyArray<Settled>
  readonly open: boolean
  readonly onChange: (open: boolean) => M
}

const outcomeLabel: { readonly [O in Outcome]: string } = { fixed: "Fixed", answered: "Answered", dropped: "Dropped" }

const outcomeColor: { readonly [O in Outcome]: string } = { fixed: "green", answered: "blue", dropped: "gray" }

const countText = (count: number): string =>
  count === 1 ? "1 thread settled by agents" : `${count} threads settled by agents`

const Item = <M>(h: HtmlBuilder<M>, thread: Settled): Html =>
  ui.Group(h, {
    gap: "xs",
    align: "flex-start",
    wrap: "nowrap",
    attributes: { root: { role: "listitem" } },
    children: [
      ui.Badge(h, {
        size: "xs",
        variant: "light",
        color: outcomeColor[thread.outcome],
        children: [outcomeLabel[thread.outcome]]
      }),
      ui.Stack(h, {
        gap: 2,
        miw: 0,
        children: [ui.Code(h, { children: [thread.thread] }), ui.Text(h, { size: "sm", children: [thread.note] })]
      })
    ]
  })

export const SettledList = <M>(h: HtmlBuilder<M>, props: SettledListProps<M>): Html =>
  props.settled.length === 0
    ? Nothing(h)
    : ui.Accordion(h, {
        id: props.id,
        variant: "default",
        chevronPosition: "left",
        value: props.open ? "settled" : null,
        onChange: (value) => props.onChange(value !== null),
        children: [
          accordionItem({
            value: "settled",
            children: [
              accordionControl({
                children: [ui.Text(h, { size: "sm", c: "dimmed", children: [countText(props.settled.length)] })]
              }),
              accordionPanel({
                children: [
                  ui.Stack(h, {
                    gap: "xs",
                    attributes: { root: { role: "list" } },
                    children: props.settled.map((thread) => Item(h, thread))
                  })
                ]
              })
            ]
          })
        ]
      })
