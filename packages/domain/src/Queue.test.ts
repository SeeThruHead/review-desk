import { describe, expect, it } from "@effect/vitest"
import { busyBoard, mergedCard, reviewingCard } from "@review-desk/contract/Sample.testing.ts"
import { countIn, sectionOf } from "./Queue.ts"

describe("which part of the queue a pull request is in", () => {
  it("puts ready reviews in the sidebar, busy agents in working, finished work in history and the rest in the queue", () => {
    expect(countIn(busyBoard.cards, "ready")).toBe(3)
    expect(countIn(busyBoard.cards, "working")).toBe(2)
    expect(countIn(busyBoard.cards, "queue")).toBe(5)
    expect(countIn(busyBoard.cards, "history")).toBe(4)
  })

  it("never counts a merged pull request as being worked on, even when its session is busy elsewhere", () => {
    expect(sectionOf({ ...mergedCard, agent: reviewingCard.agent })).toBe("history")
  })
})
