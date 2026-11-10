import type { Card } from "@review-desk/contract/Board.ts"

export type QueueSection = "ready" | "working" | "queue" | "history"

export const sectionOf = (card: Card): QueueSection => {
  if (card.stage === "ready" && card.role === "reviewer") return "ready"
  if (card.stage === "reviewed" || card.stage === "merged") return "history"

  return card.agent?.working === true ? "working" : "queue"
}

export const countIn = (cards: ReadonlyArray<Card>, section: QueueSection): number =>
  cards.filter((card) => sectionOf(card) === section).length
