import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type AlertProps<M> = {
  readonly tone: "error" | "warning" | "info"
  readonly text: string
  readonly onDismiss?: M
}

const colorOf = { error: "red", warning: "yellow", info: "blue" } as const

export const Alert = <M>(h: HtmlBuilder<M>, props: AlertProps<M>): Html =>
  ui.Alert(h, {
    variant: "light",
    color: colorOf[props.tone],
    role: props.tone === "info" ? "status" : "alert",
    ...(props.onDismiss === undefined
      ? {}
      : { withCloseButton: true, closeButtonLabel: "Dismiss", onClose: props.onDismiss }),
    children: [props.text]
  })
