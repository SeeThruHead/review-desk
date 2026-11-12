import type { PrKey } from "@review-desk/contract/Ids.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type NeedRow = {
  readonly key: PrKey
  readonly title: string
  readonly url: string
  readonly place: string
  readonly why: string
}

export type NeedListProps<M> = {
  readonly needs: ReadonlyArray<NeedRow>
  readonly onSeen: (key: PrKey) => M
}

const Row = <M>(h: HtmlBuilder<M>, need: NeedRow, onSeen: (key: PrKey) => M): Html =>
  ui.Paper(h, {
    withBorder: true,
    radius: "md",
    p: "sm",
    attributes: { root: { role: "listitem", "aria-label": need.title } },
    children: [
      ui.Stack(h, {
        gap: 4,
        children: [
          ui.Text(h, { size: "xs", c: "dimmed", ff: "monospace", children: [need.place] }),
          ui.Anchor(h, {
            href: need.url,
            target: "_blank",
            rel: "noreferrer",
            size: "sm",
            fw: 600,
            children: [need.title]
          }),
          ui.Group(h, {
            justify: "space-between",
            wrap: "nowrap",
            gap: "sm",
            children: [
              ui.Text(h, { size: "sm", c: "orange", children: [need.why] }),
              ui.Button(h, {
                size: "compact-xs",
                variant: "subtle",
                onClick: onSeen(need.key),
                attributes: { root: { "aria-label": `Mark ${need.title} seen` } },
                children: ["Seen"]
              })
            ]
          })
        ]
      })
    ]
  })

export const NeedList = <M>(h: HtmlBuilder<M>, props: NeedListProps<M>): Html =>
  ui.Stack(h, {
    gap: "sm",
    attributes: { root: { role: "list", "aria-label": `Also needs you, ${props.needs.length}` } },
    children: [
      ui.Title(h, { order: 3, size: "h5", children: ["Also needs you"] }),
      ...props.needs.map((need) => Row(h, need, props.onSeen))
    ]
  })
