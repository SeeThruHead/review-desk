import type { Verdict } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { Child } from "@seethruhead/sth-ui/core/content.ts"
import { ui } from "../theme/ui.ts"
import { verdictLabel } from "./Verdict.ts"

export const ReadyQueue = <M>(
  h: HtmlBuilder<M>,
  props: { readonly count: number; readonly children: ReadonlyArray<Child> }
): Html =>
  ui.Paper(h, {
    component: "aside",
    withBorder: true,
    radius: "lg",
    p: "md",
    attributes: { root: { "aria-label": "Needs you" } },
    children: [
      ui.Stack(h, {
        gap: "lg",
        children: [
          ui.Group(h, {
            gap: "sm",
            attributes: { root: { role: "heading", "aria-level": "2", "aria-label": `Needs you, ${props.count}` } },
            children: [
              ui.Title(h, { order: 2, size: "h3", children: ["Needs you"] }),
              ui.Badge(h, {
                size: "lg",
                circle: true,
                color: props.count > 0 ? "red" : "gray",
                children: [String(props.count)]
              })
            ]
          }),
          props.count === 0
            ? ui.EmptyState(h, {
                size: "sm",
                align: "left",
                description: "Nothing needs you right now. The agents are on it."
              })
            : ui.Stack(h, { gap: "lg", children: props.children })
        ]
      })
    ]
  })

export const VerdictGroup = <M>(
  h: HtmlBuilder<M>,
  props: { readonly verdict: Verdict; readonly children: ReadonlyArray<Child> }
): Html =>
  ui.Stack(h, {
    gap: "sm",
    attributes: { root: { role: "group", "aria-label": verdictLabel[props.verdict] } },
    children: [
      ui.Group(h, {
        gap: "xs",
        children: [
          ui.Title(h, { order: 3, size: "h5", children: [verdictLabel[props.verdict]] }),
          ui.Text(h, { size: "sm", c: "dimmed", children: [String(props.children.length)] })
        ]
      }),
      ui.Stack(h, { gap: "md", children: props.children })
    ]
  })
