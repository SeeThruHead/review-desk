import { Board, type Card, type Mention, type Verdict } from "@review-desk/contract/Board.ts"
import { PrKey } from "@review-desk/contract/Ids.ts"
import { sectionOf } from "@review-desk/domain/Queue.ts"
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

export type SectionName = "reviewing" | "mine" | "history"

const sectionOrder: ReadonlyArray<SectionName> = ["reviewing", "mine", "history"]

const laneOf = (card: Card): SectionName => {
  if (card.stage === "merged") return "history"
  if (card.role === "author") return "mine"

  return card.stage === "reviewed" ? "history" : "reviewing"
}

const verdictOrder: ReadonlyArray<Verdict> = ["architecture", "look", "skim"]

const isReadyForMe = (card: Card): boolean => sectionOf(card) === "ready"

const inReadyQueue = (card: Card): boolean => isReadyForMe(card) && card.attention !== null

const newestFirst = (cards: ReadonlyArray<Card>): ReadonlyArray<Card> =>
  cards.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))

const verdictOf = (card: Card): Verdict => card.triage?.verdict ?? "look"

const readyInOrder = (board: Board): ReadonlyArray<Card> => {
  const ready = board.cards.filter(inReadyQueue)
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

export const readyCount = (board: Board): number => board.cards.filter(inReadyQueue).length

export const workingCount = (board: Board): number =>
  board.cards.filter((card) => card.stage !== "merged" && card.agent?.working === true).length

export const sectionsOf = (
  board: Board
): ReadonlyArray<{ readonly section: SectionName; readonly cards: ReadonlyArray<Card> }> =>
  sectionOrder.map((section) => ({
    section,
    cards: newestFirst(board.cards.filter((card) => !inReadyQueue(card) && laneOf(card) === section))
  }))

export type Need = {
  readonly key: PrKey
  readonly title: string
  readonly url: string
  readonly place: string
  readonly why: string
  readonly at: string
}

const needOf = (item: Card | Mention): ReadonlyArray<Need> =>
  item.attention === null
    ? []
    : [
        {
          key: item.key,
          title: item.title,
          url: item.url,
          place: `${item.repo}#${item.number}`,
          why: item.attention.why,
          at: item.attention.at
        }
      ]

export const otherNeeds = (board: Board): ReadonlyArray<Need> =>
  [
    ...board.cards.filter((card) => card.stage !== "merged" && !isReadyForMe(card)).flatMap(needOf),
    ...board.mentions.flatMap(needOf)
  ].toSorted((a, b) => b.at.localeCompare(a.at))

export const needsCount = (board: Board): number => readyCount(board) + otherNeeds(board).length

export const mentionsOf = (board: Board): ReadonlyArray<Mention> =>
  board.mentions.toSorted((a, b) => b.at.localeCompare(a.at))

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })

export const timeOf = (iso: string): string => clock.format(DateTime.toDateUtc(DateTime.makeUnsafe(iso)))

export const polledText = (board: Board): string =>
  board.polledAt === null ? "Not checked yet" : `Checked ${timeOf(board.polledAt)}`

const readAt = (board: Board): string =>
  board.health.lastGood === null
    ? "Nothing read from GitHub yet"
    : `Showing what was read at ${timeOf(board.health.lastGood)}`

export const healthText = (board: Board): string | null => {
  const health = board.health
  if (health.state === "live") return null
  const reason = health.reason === null ? "" : `: ${health.reason}`
  if (health.state === "stale") return `${readAt(board)}${reason}.`
  const until = health.until === null ? "" : `, reading again at ${timeOf(health.until)}`

  return `Paused${reason}${until}. ${readAt(board)}.`
}

export const routingText = (board: Board): string | null =>
  board.routing.reason === null ? null : `${board.routing.on ? "Routing" : "Routing off"}: ${board.routing.reason}.`

const number = new Intl.NumberFormat("en")

export const budgetText = (board: Board): string | null => {
  const budget = board.budget
  if (budget === null) return null
  const left = `GitHub budget ${number.format(budget.remaining)} of ${number.format(budget.limit)}`

  return budget.slowed ? `${left}, reading less often until ${timeOf(budget.resetAt)}` : left
}
