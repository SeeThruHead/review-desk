import type { Round } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

const roundText = (round: Round): string =>
  round.number >= round.limit
    ? `Round ${round.number} of ${round.limit}, last round`
    : `Round ${round.number} of ${round.limit}`

export const RoundBadge = <M>(h: HtmlBuilder<M>, props: { readonly round: Round }): Html =>
  ui.Group(h, {
    gap: "xs",
    children: [
      ui.Badge(h, {
        variant: "outline",
        color: props.round.number >= props.round.limit ? "red" : "blue",
        children: [roundText(props.round)]
      }),
      ui.Text(h, {
        size: "sm",
        c: "dimmed",
        children: [props.round.turn === "mine" ? "Your agent's turn" : "Their agent's turn"]
      })
    ]
  })
