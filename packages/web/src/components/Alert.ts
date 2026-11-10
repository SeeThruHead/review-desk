import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type AlertProps<M> = {
  readonly tone: "error" | "warning"
  readonly text: string
  readonly onDismiss?: M
}

export const Alert = <M>(h: HtmlBuilder<M>, props: AlertProps<M>): Html =>
  ui.Alert(h, {
    variant: "light",
    color: props.tone === "error" ? "red" : "yellow",
    role: "alert",
    ...(props.onDismiss === undefined
      ? {}
      : { withCloseButton: true, closeButtonLabel: "Dismiss", onClose: props.onDismiss }),
    children: [props.text]
  })
