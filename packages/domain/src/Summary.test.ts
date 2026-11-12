import { describe, expect, it } from "@effect/vitest"
import {
  busyBoard,
  issueMention,
  mergeReadyCard,
  pullMention,
  quietBoard,
  troubledBoard,
  waitingCard
} from "@review-desk/contract/Sample.testing.ts"
import type { Card } from "@review-desk/contract/Board.ts"
import { IsoTime, PrKey, Text } from "@review-desk/contract/Ids.ts"
import { summaryOf } from "./Summary.ts"

describe("the summary the menu bar shows", () => {
  it("is all zeros on a quiet desk", () => {
    expect(summaryOf(quietBoard)).toEqual({
      needsYou: 0,
      reviewing: { total: 0, needsYou: 0 },
      mine: { total: 0, needsYou: 0 },
      mentions: { total: 0, needsYou: 0 },
      agents: { working: 0, talking: 0 },
      top: [],
      health: quietBoard.health,
      routing: quietBoard.routing
    })
  })

  it("counts each section and what in it needs him, leaving merged pull requests out", () => {
    const summary = summaryOf(busyBoard)

    expect(summary.reviewing).toEqual({ total: 6, needsYou: 3 })
    expect(summary.mine).toEqual({ total: 7, needsYou: 2 })
    expect(summary.mentions).toEqual({ total: 2, needsYou: 1 })
    expect(summary.needsYou).toBe(6)
    expect(summary.agents).toEqual({ working: 2, talking: 2 })
  })

  it("lists what needs him newest first, with why", () => {
    const summary = summaryOf(busyBoard)

    expect(summary.top[0]).toEqual({
      key: busyBoard.cards[0]?.key,
      title: busyBoard.cards[0]?.title,
      url: busyBoard.cards[0]?.url,
      section: "reviewing",
      why: "The agent's review is done: an architecture call for you"
    })
    expect(summary.top.map((item) => item.section)).toEqual([
      "reviewing",
      "reviewing",
      "reviewing",
      "mentions",
      "mine",
      "mine"
    ])
    expect(summary.top.find((item) => item.key === issueMention.key)?.why).toBe("sam mentioned you")
    expect(summary.top.some((item) => item.key === pullMention.key)).toBe(false)
    expect(summary.top.map((item) => item.key)).toContain(mergeReadyCard.key)
    expect(summary.top.map((item) => item.key)).toContain(waitingCard.key)
  })

  it("lists at most eight", () => {
    const many: ReadonlyArray<Card> = Array.from({ length: 10 }, (_, index) => ({
      ...waitingCard,
      key: PrKey.make(`github:you/ui-kit#${100 + index}`),
      attention: {
        why: Text.make("CI failed and no agent is on it"),
        at: IsoTime.make(`2026-11-05T12:${10 + index}:00Z`)
      }
    }))
    const summary = summaryOf({ ...quietBoard, cards: many })

    expect(summary.needsYou).toBe(10)
    expect(summary.top).toHaveLength(8)
    expect(summary.top[0]?.key).toBe("github:you/ui-kit#109")
  })

  it("passes on stale data and routing that is off", () => {
    const summary = summaryOf(troubledBoard)

    expect(summary.health.state).toBe("paused")
    expect(summary.health.until).toBe("2026-11-05T20:12:00Z")
    expect(summary.routing.on).toBe(false)
  })
})
