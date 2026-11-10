import type { Verdict } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export const verdictLabel: { readonly [V in Verdict]: string } = {
  architecture: "Needs your architectural eye",
  look: "Worth a real look",
  skim: "Probably safe, skim it"
}

const verdictColor: { readonly [V in Verdict]: string } = { architecture: "red", look: "orange", skim: "teal" }

export const VerdictBadge = <M>(h: HtmlBuilder<M>, props: { readonly verdict: Verdict }): Html =>
  ui.Badge(h, {
    color: verdictColor[props.verdict],
    variant: "light",
    size: "md",
    children: [verdictLabel[props.verdict]]
  })
