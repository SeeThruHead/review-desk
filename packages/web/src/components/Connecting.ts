import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export const Connecting = <M>(h: HtmlBuilder<M>): Html =>
  ui.Group(h, {
    gap: "sm",
    py: "xl",
    justify: "center",
    children: [
      ui.Loader(h, { size: "sm", type: "dots" }),
      ui.Text(h, { c: "dimmed", children: ["Connecting to your desk"] })
    ]
  })
