import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type SectionProps = {
  readonly title: string
  readonly hint: string
  readonly count: number
  readonly children: ReadonlyArray<Html>
}

export const Section = <M>(h: HtmlBuilder<M>, props: SectionProps): Html =>
  ui.Box(h, {
    component: "section",
    attributes: { root: { "aria-label": props.title } },
    children: [
      ui.Stack(h, {
        gap: "xs",
        children: [
          ui.Group(h, {
            gap: "xs",
            align: "baseline",
            children: [
              ui.Title(h, {
                order: 2,
                size: "h4",
                children: [
                  props.title,
                  " ",
                  ui.Badge(h, { size: "sm", variant: "default", children: [String(props.count)] })
                ]
              }),
              ui.Text(h, { size: "sm", c: "dimmed", children: [props.hint] })
            ]
          }),
          props.children.length === 0
            ? ui.EmptyState(h, { size: "xs", align: "left", description: "Nothing here" })
            : ui.Box(h, { children: props.children })
        ]
      })
    ]
  })
