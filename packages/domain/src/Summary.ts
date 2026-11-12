import type { Attention, Board, Card, Mention } from "@review-desk/contract/Board.ts"
import type { NeedItem, SectionCount, Summary, SummarySection } from "@review-desk/contract/Contract.ts"
import { Count } from "@review-desk/contract/Ids.ts"

const topLimit = 8

type Needed = { readonly item: NeedItem; readonly at: string }

const isOpen = (card: Card): boolean => card.stage !== "merged"

const countOf = (items: ReadonlyArray<{ readonly attention: Attention | null }>): SectionCount => ({
  total: Count.make(items.length),
  needsYou: Count.make(items.filter((item) => item.attention !== null).length)
})

const neededOf = (
  section: SummarySection,
  items: ReadonlyArray<Pick<Card | Mention, "key" | "title" | "url" | "attention">>
): ReadonlyArray<Needed> =>
  items.flatMap((item) =>
    item.attention === null
      ? []
      : [
          {
            item: { key: item.key, title: item.title, url: item.url, section, why: item.attention.why },
            at: item.attention.at
          }
        ]
  )

export const summaryOf = (board: Board): Summary => {
  const open = board.cards.filter(isOpen)
  const reviewing = open.filter((card) => card.role === "reviewer")
  const mine = open.filter((card) => card.role === "author")
  const needed = [
    ...neededOf("reviewing", reviewing),
    ...neededOf("mine", mine),
    ...neededOf("mentions", board.mentions)
  ].toSorted((a, b) => b.at.localeCompare(a.at))

  return {
    needsYou: Count.make(needed.length),
    reviewing: countOf(reviewing),
    mine: countOf(mine),
    mentions: countOf(board.mentions),
    agents: {
      working: Count.make(open.filter((card) => card.agent?.working === true).length),
      talking: Count.make(open.filter((card) => card.stage === "talking").length)
    },
    top: needed.slice(0, topLimit).map((entry) => entry.item),
    health: board.health,
    routing: board.routing
  }
}
