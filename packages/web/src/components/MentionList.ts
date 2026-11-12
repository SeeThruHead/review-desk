import type { Mention } from "@review-desk/contract/Board.ts"
import type { PrKey } from "@review-desk/contract/Ids.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

export type MentionListProps<M> = {
  readonly mentions: ReadonlyArray<Mention>
  readonly time: (iso: string) => string
  readonly onSeen: (key: PrKey) => M
}

const kindName = { pull: "pull request", issue: "issue" } as const

const Row = <M>(h: HtmlBuilder<M>, mention: Mention, props: MentionListProps<M>): Html =>
  ui.Box(h, {
    p: "sm",
    attributes: { root: { role: "listitem", "aria-label": mention.title } },
    children: [
      ui.Group(h, {
        justify: "space-between",
        wrap: "nowrap",
        align: "flex-start",
        gap: "md",
        children: [
          ui.Stack(h, {
            gap: 2,
            flex: 1,
            miw: 0,
            children: [
              ui.Anchor(h, {
                href: mention.url,
                target: "_blank",
                rel: "noreferrer",
                size: "sm",
                fw: mention.attention === null ? 400 : 600,
                truncate: true,
                children: [mention.title]
              }),
              ui.Text(h, {
                size: "xs",
                c: "dimmed",
                children: [
                  `${mention.repo}#${mention.number}, ${kindName[mention.kind]}, ${mention.by} at ${props.time(mention.at)}`
                ]
              }),
              ui.Text(h, { size: "sm", lineClamp: 2, children: [mention.text] })
            ]
          }),
          ...(mention.attention === null
            ? []
            : [
                ui.Button(h, {
                  size: "compact-xs",
                  variant: "subtle",
                  onClick: props.onSeen(mention.key),
                  attributes: { root: { "aria-label": `Mark ${mention.title} seen` } },
                  children: ["Seen"]
                })
              ])
        ]
      })
    ]
  })

export const MentionList = <M>(h: HtmlBuilder<M>, props: MentionListProps<M>): Html =>
  ui.Paper(h, {
    withBorder: true,
    radius: "md",
    attributes: { root: { role: "list", "aria-label": "Mentions" } },
    children: [
      ui.Stack(h, {
        gap: 0,
        children: [
          ui.Text(h, {
            size: "xs",
            c: "dimmed",
            p: "sm",
            children: ["Text from other people, shown to you only; it never reaches an agent."]
          }),
          ...props.mentions.map((mention) => Row(h, mention, props))
        ]
      })
    ]
  })
