import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type DeskHeaderProps = {
  readonly desk: string
  readonly needs: number
  readonly working: number
  readonly polled: string
  readonly budget: string | null
}

const agentsText = (count: number): string => (count === 1 ? "1 agent working" : `${count} agents working`)

export const DeskHeader = <M>(h: HtmlBuilder<M>, props: DeskHeaderProps): Html =>
  ui.Box(h, {
    component: "header",
    children: [
      ui.Group(h, {
        justify: "space-between",
        align: "center",
        children: [
          ui.Group(h, {
            gap: "sm",
            align: "baseline",
            children: [
              ui.Title(h, { order: 1, size: "h2", children: ["Review Desk"] }),
              ui.Text(h, { c: "dimmed", size: "sm", children: [props.desk] })
            ]
          }),
          ui.Group(h, {
            gap: "sm",
            children: [
              ui.Badge(h, {
                size: "lg",
                color: props.needs > 0 ? "red" : "gray",
                variant: "filled",
                children: [`${props.needs} need you`]
              }),
              ui.Badge(h, { size: "lg", color: "green", variant: "light", children: [agentsText(props.working)] }),
              ui.Stack(h, {
                gap: 0,
                children: [
                  ui.Text(h, { size: "xs", c: "dimmed", children: [props.polled] }),
                  ...(props.budget === null ? [] : [ui.Text(h, { size: "xs", c: "dimmed", children: [props.budget] })])
                ]
              })
            ]
          })
        ]
      })
    ]
  })
