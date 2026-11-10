import { Board, type Card, type Verdict } from "@review-desk/contract/Board.ts"
import { PrKey } from "@review-desk/contract/Ids.ts"
import { countIn, sectionOf } from "@review-desk/domain/Queue.ts"
import { DateTime, Schema } from "effect"
import * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"

export const Connection = Schema.Literals(["connecting", "live", "lost"])

export const Model = Schema.Struct({
  connection: Connection,
  board: Schema.NullOr(Board),
  notice: Schema.NullOr(Schema.String),
  expanded: Schema.Array(PrKey),
  settledOpen: Schema.Array(PrKey),
  sidebar: ScrollArea.Model
})
export type Model = typeof Model.Type

export const connecting: Model = {
  connection: "connecting",
  board: null,
  notice: null,
  expanded: [],
  settledOpen: [],
  sidebar: ScrollArea.init({ id: "ready-sidebar" })
}

export type SectionName = "working" | "queue" | "history"

const sectionOrder: ReadonlyArray<SectionName> = ["working", "queue", "history"]

const verdictOrder: ReadonlyArray<Verdict> = ["architecture", "look", "skim"]

const isReadyForMe = (card: Card): boolean => sectionOf(card) === "ready"

const newestFirst = (cards: ReadonlyArray<Card>): ReadonlyArray<Card> =>
  cards.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))

const verdictOf = (card: Card): Verdict => card.triage?.verdict ?? "look"

const readyInOrder = (board: Board): ReadonlyArray<Card> => {
  const ready = board.cards.filter(isReadyForMe)
  const ordered = board.ready.flatMap((key) => ready.filter((card) => card.key === key))

  return [...ordered, ...ready.filter((card) => !board.ready.includes(card.key))]
}

export const readyGroups = (
  board: Board
): ReadonlyArray<{ readonly verdict: Verdict; readonly cards: ReadonlyArray<Card> }> => {
  const ready = readyInOrder(board)

  return verdictOrder
    .map((verdict) => ({ verdict, cards: ready.filter((card) => verdictOf(card) === verdict) }))
    .filter((group) => group.cards.length > 0)
}

export const readyCount = (board: Board): number => board.cards.filter(isReadyForMe).length

export const workingCount = (board: Board): number => countIn(board.cards, "working")

export const sectionsOf = (
  board: Board
): ReadonlyArray<{ readonly section: SectionName; readonly cards: ReadonlyArray<Card> }> =>
  sectionOrder.map((section) => ({
    section,
    cards: newestFirst(board.cards.filter((card) => sectionOf(card) === section))
  }))

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })

export const polledText = (board: Board): string =>
  board.polledAt === null
    ? "Not checked yet"
    : `Checked ${clock.format(DateTime.toDateUtc(DateTime.makeUnsafe(board.polledAt)))}`
