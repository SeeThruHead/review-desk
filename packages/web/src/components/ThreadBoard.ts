import type { Outcome, ThreadStatus, ThreadView } from "@review-desk/contract/Board.ts"
import type { Html, HtmlBuilder } from "foldkit/html"
import { ui } from "../theme/ui.ts"

const columns: ReadonlyArray<{ readonly status: ThreadStatus; readonly title: string }> = [
  { status: "open", title: "Open" },
  { status: "settled", title: "Settled" },
  { status: "for-you", title: "Left for you" }
]

const outcomeLabel: { readonly [O in Outcome]: string } = { fixed: "Fixed", answered: "Answered", dropped: "Dropped" }

const tagOf = (thread: ThreadView): string => {
  if (thread.outcome !== null) return outcomeLabel[thread.outcome]
  if (thread.turn === "mine") return `Your agent's turn, round ${thread.round}`
  if (thread.turn === "theirs") return `Their agent's turn, round ${thread.round}`

  return `Used all rounds (${thread.round})`
}

const Item = <M>(h: HtmlBuilder<M>, thread: ThreadView): Html =>
  ui.Paper(h, {
    withBorder: true,
    radius: "sm",
    p: "xs",
    attributes: { root: { role: "listitem" } },
    children: [
      ui.Stack(h, {
        gap: 4,
        children: [
          ui.Code(h, { children: [thread.thread] }),
          ui.Text(h, { size: "xs", c: "dimmed", children: [tagOf(thread)] }),
          ui.Text(h, { size: "sm", children: [thread.latest] })
        ]
      })
    ]
  })

const Column = <M>(h: HtmlBuilder<M>, title: string, threads: ReadonlyArray<ThreadView>): Html =>
  ui.Stack(h, {
    gap: 6,
    miw: 0,
    children: [
      ui.Text(h, { size: "xs", fw: 700, tt: "uppercase", c: "dimmed", children: [`${title} ${threads.length}`] }),
      ui.Stack(h, {
        gap: 6,
        attributes: { root: { role: "list", "aria-label": `${title}, ${threads.length}` } },
        children: threads.map((thread) => Item(h, thread))
      })
    ]
  })

export const ThreadBoard = <M>(h: HtmlBuilder<M>, props: { readonly threads: ReadonlyArray<ThreadView> }): Html =>
  props.threads.length === 0
    ? ui.Text(h, { size: "sm", c: "dimmed", children: ["No agent threads yet"] })
    : ui.SimpleGrid(h, {
        cols: { base: 1, sm: 3 },
        spacing: "sm",
        children: columns.map((column) =>
          Column(
            h,
            column.title,
            props.threads.filter((thread) => thread.status === column.status)
          )
        )
      })
