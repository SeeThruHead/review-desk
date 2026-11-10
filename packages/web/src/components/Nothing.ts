import type { Html, HtmlBuilder } from "foldkit/html"

export const Nothing = <M>(h: HtmlBuilder<M>): Html => h.span([h.AriaHidden(true)], [])
