import type { Html, HtmlBuilder } from "foldkit/html"
import type { Child } from "@seethruhead/sth-ui/core/content.ts"
import type * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import { ui } from "../theme/ui.ts"

export type DeskLayoutProps<M> = {
  readonly header: Child
  readonly alerts: ReadonlyArray<Child>
  readonly main: ReadonlyArray<Child>
  readonly sidebar: Child
  readonly sidebarScroll: {
    readonly model: ScrollArea.Model
    readonly toParentMessage: (message: ScrollArea.Message) => M
  }
}

const wide = "md"

export const DeskLayout = <M>(h: HtmlBuilder<M>, props: DeskLayoutProps<M>): Html =>
  ui.Container(h, {
    size: 1600,
    px: { base: "sm", [wide]: "xl" },
    py: "lg",
    children: [
      ui.Stack(h, {
        gap: "lg",
        children: [
          props.header,
          ui.Flex(h, {
            direction: { base: "column-reverse", [wide]: "row" },
            gap: "xl",
            children: [
              ui.Box(h, {
                component: "main",
                flex: 1,
                miw: 0,
                children: [ui.Stack(h, { gap: "xl", children: [...props.alerts, ...props.main] })]
              }),
              ui.Box(h, {
                flex: "none",
                w: { base: "100%", [wide]: 400 },
                children: [
                  ui.Box(h, {
                    pos: { base: "static", [wide]: "sticky" },
                    top: 16,
                    children: [
                      ui.ScrollAreaAutosize(h, {
                        ...props.sidebarScroll,
                        mah: { base: "none", [wide]: "calc(100vh - 32px)" },
                        children: [props.sidebar]
                      })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      })
    ]
  })
