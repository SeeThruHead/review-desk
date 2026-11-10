import type { Checks } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"
import { Nothing } from "./Nothing.ts"

const shown: { readonly [C in Exclude<Checks, "none">]: { readonly text: string; readonly color: string } } = {
  passed: { text: "CI passed", color: "green" },
  failed: { text: "CI failed", color: "red" },
  pending: { text: "CI running", color: "yellow" }
}

export const ChecksBadge = <M>(h: HtmlBuilder<M>, props: { readonly checks: Checks }): Html =>
  props.checks === "none"
    ? Nothing(h)
    : ui.Badge(h, {
        variant: "dot",
        color: shown[props.checks].color,
        size: "sm",
        children: [shown[props.checks].text]
      })
