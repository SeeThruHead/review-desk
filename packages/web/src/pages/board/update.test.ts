import { describe, expect, it } from "@effect/vitest"
import {
  busyBoard,
  issueMention,
  lookCard,
  mergedCard,
  quietBoard,
  reviewingCard,
  talkingCard,
  troubledBoard
} from "@review-desk/contract/Sample.testing.ts"
import { Count, IsoTime, Text } from "@review-desk/contract/Ids.ts"
import { Command, given, message, model, story } from "foldkit/story"
import { MarkSeen, OpenInSidediff } from "./commands.ts"
import { Message } from "./message.ts"
import {
  budgetText,
  connecting,
  healthText,
  mentionsOf,
  needsCount,
  otherNeeds,
  polledText,
  readyCount,
  readyGroups,
  routingText,
  sectionsOf,
  timeOf,
  workingCount
} from "./model.ts"
import { HideAfterDelay, ScrollAreaCommandMessage } from "@seethruhead/sth-ui/core/components/ScrollArea/commands.ts"
import * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import { update } from "./update.ts"

const live = { ...connecting, connection: "live" as const, board: busyBoard }

describe("the board page", () => {
  it("shows the board as soon as the desk sends it, and keeps the last board when the connection drops", () => {
    story(
      update,
      given(connecting),
      message(Message.ReceivedBoard({ board: busyBoard })),
      model((m) => {
        expect(m.connection).toBe("live")
        expect(m.board).toEqual(busyBoard)
      }),
      message(Message.LostConnection()),
      model((m) => {
        expect(m.connection).toBe("lost")
        expect(m.board).toEqual(busyBoard)
      }),
      message(Message.ReceivedBoard({ board: quietBoard })),
      model((m) => {
        expect(m.connection).toBe("live")
        expect(m.board).toEqual(quietBoard)
      }),
      Command.expectNone()
    )
  })

  it("opens a pull request in sidediff and says so when sidediff fails", () => {
    story(
      update,
      given(live),
      message(Message.ClickedOpenInSidediff({ key: lookCard.key })),
      Command.expectExact(OpenInSidediff({ key: lookCard.key })),
      Command.resolve(
        OpenInSidediff({ key: lookCard.key }),
        Message.FailedToOpenInSidediff({ reason: Text.make("sidediff is not installed") })
      ),
      model((m) => expect(m.notice).toBe("sidediff is not installed")),
      message(Message.DismissedNotice()),
      model((m) => expect(m.notice).toBeNull()),
      message(Message.ClickedOpenInSidediff({ key: lookCard.key })),
      Command.resolve(OpenInSidediff({ key: lookCard.key }), Message.OpenedInSidediff()),
      model((m) => expect(m.notice).toBeNull()),
      Command.expectNone()
    )
  })
})

describe("opening a row", () => {
  it("opens a pull request's details on click and closes them on the next", () => {
    story(
      update,
      given(live),
      message(Message.ChangedOpenPulls({ shown: [talkingCard.key, mergedCard.key], open: [talkingCard.key] })),
      model((m) => expect(m.expanded).toEqual([talkingCard.key])),
      message(Message.ChangedOpenPulls({ shown: [reviewingCard.key], open: [reviewingCard.key] })),
      model((m) => expect(m.expanded).toEqual([talkingCard.key, reviewingCard.key])),
      message(Message.ChangedOpenPulls({ shown: [talkingCard.key, mergedCard.key], open: [mergedCard.key] })),
      model((m) => expect(m.expanded).toEqual([reviewingCard.key, mergedCard.key])),
      Command.expectNone()
    )
  })
})

describe("showing a card's settled threads", () => {
  it("keeps each card's settled threads open or closed on its own", () => {
    story(
      update,
      given(live),
      message(Message.ToggledSettled({ key: lookCard.key, open: true })),
      message(Message.ToggledSettled({ key: talkingCard.key, open: true })),
      model((m) => expect(m.settledOpen).toEqual([lookCard.key, talkingCard.key])),
      message(Message.ToggledSettled({ key: lookCard.key, open: false })),
      model((m) => expect(m.settledOpen).toEqual([talkingCard.key])),
      Command.expectNone()
    )
  })
})

describe("scrolling the sidebar", () => {
  it("hands the sidebar's scroll events to sth-ui's ScrollArea and keeps what it returns", () => {
    story(
      update,
      given(live),
      message(Message.GotSidebarScroll({ message: ScrollArea.Message.EnteredRoot() })),
      model((m) => expect(m.sidebar).toEqual(ScrollArea.update(live.sidebar, ScrollArea.Message.EnteredRoot()).model)),
      message(Message.GotSidebarScroll({ message: ScrollArea.Message.LeftRoot() })),
      Command.resolve(HideAfterDelay, ScrollAreaCommandMessage.Waited()),
      Command.expectNone()
    )
  })
})

describe("what goes where on the board", () => {
  it("groups the ready queue by verdict in the desk's order and puts every other card in its lane", () => {
    const groups = readyGroups(busyBoard)
    expect(groups.map((group) => [group.verdict, group.cards.map((card) => card.number)])).toEqual([
      ["architecture", [212]],
      ["look", [215]],
      ["skim", [88]]
    ])

    const sections = sectionsOf(busyBoard)
    expect(sections.map((section) => [section.section, section.cards.map((card) => card.number)])).toEqual([
      ["reviewing", [218, 3]],
      ["mine", [41, 7, 91, 47, 43, 90, 86]],
      ["history", [201, 5]]
    ])
  })

  it("counts agents working and keeps ready cards the desk has not ordered yet at the end", () => {
    expect(readyCount(busyBoard)).toBe(3)
    expect(workingCount(busyBoard)).toBe(2)
    expect(workingCount(quietBoard)).toBe(0)
    const unordered = { ...busyBoard, ready: [] }
    expect(readyGroups(unordered).flatMap((group) => group.cards.map((card) => card.number))).toEqual([212, 215, 88])
    expect(sectionsOf(quietBoard).every((section) => section.cards.length === 0)).toBe(true)
    const readyUntriaged = {
      ...reviewingCard,
      stage: "ready" as const,
      triage: null,
      attention: { why: Text.make("The agent's review is done"), at: IsoTime.make("2026-11-05T15:00:00Z") }
    }
    expect(readyGroups({ ...quietBoard, cards: [readyUntriaged] })).toEqual([
      { verdict: "look", cards: [readyUntriaged] }
    ])
    expect(readyGroups({ ...quietBoard, cards: [{ ...readyUntriaged, attention: null }] })).toEqual([])
  })

  it("says when the desk last checked, or that it has not yet", () => {
    expect(polledText({ ...busyBoard, polledAt: null })).toBe("Not checked yet")
    expect(polledText(busyBoard)).toMatch(/^Checked \d{1,2}:\d{2}/)
  })
})

describe("marking something seen", () => {
  it("asks the desk to clear it, and says so when the desk refuses", () => {
    story(
      update,
      given(live),
      message(Message.ClickedSeen({ key: issueMention.key })),
      Command.expectExact(MarkSeen({ key: issueMention.key })),
      Command.resolve(MarkSeen({ key: issueMention.key }), Message.MarkedSeen()),
      model((m) => expect(m.notice).toBeNull()),
      message(Message.ClickedSeen({ key: issueMention.key })),
      Command.resolve(
        MarkSeen({ key: issueMention.key }),
        Message.FailedToMarkSeen({ reason: Text.make("Review Desk is not watching it") })
      ),
      model((m) => expect(m.notice).toBe("Review Desk is not watching it")),
      Command.expectNone()
    )
  })
})

describe("what needs him", () => {
  it("counts the ready reviews and everything else that needs him, newest first", () => {
    expect(needsCount(busyBoard)).toBe(6)
    expect(otherNeeds(busyBoard).map((need) => [need.place, need.why])).toEqual([
      ["acme/api#310", "sam mentioned you"],
      ["you/ui-kit#47", "Approved with CI passed: ready to merge"],
      ["you/ui-kit#43", "CI failed and no agent is on it"]
    ])
    expect(needsCount(quietBoard)).toBe(0)
  })

  it("lists mentions newest first", () => {
    expect(mentionsOf(busyBoard).map((mention) => mention.number)).toEqual([310, 77])
  })
})

const at = (iso: string) => timeOf(iso)

describe("saying whether the board is current", () => {
  it("says nothing while live", () => {
    expect(healthText(busyBoard)).toBeNull()
    expect(routingText(busyBoard)).toBeNull()
  })

  it("says when it paused for the rate limit and when it reads again", () => {
    expect(healthText(troubledBoard)).toBe(
      `Paused: GitHub's rate limit for this account is spent, reading again at ${at("2026-11-05T20:12:00Z")}. Showing what was read at ${at("2026-11-05T19:45:00Z")}.`
    )
    expect(healthText({ ...troubledBoard, health: { ...troubledBoard.health, reason: null, until: null } })).toBe(
      `Paused. Showing what was read at ${at("2026-11-05T19:45:00Z")}.`
    )
  })

  it("says what failed when it is stale, and that nothing was read yet when it never was", () => {
    const stale = { state: "stale" as const, reason: Text.make("github did not answer"), lastGood: null, until: null }

    expect(healthText({ ...quietBoard, health: stale })).toBe("Nothing read from GitHub yet: github did not answer.")
    expect(
      healthText({ ...quietBoard, health: { ...stale, reason: null, lastGood: IsoTime.make("2026-11-05T19:45:00Z") } })
    ).toBe(`Showing what was read at ${at("2026-11-05T19:45:00Z")}.`)
  })

  it("says when routing is off or partial", () => {
    expect(routingText(troubledBoard)).toBe("Routing off: No areas configured, so review requests stay with you.")
    expect(routingText({ ...quietBoard, routing: { on: true, reason: Text.make("No area covers acme/web") } })).toBe(
      "Routing: No area covers acme/web."
    )
  })

  it("shows the GitHub budget, and when it reads less often", () => {
    expect(budgetText(busyBoard)).toBe("GitHub budget 4,210 of 5,000")
    expect(budgetText(troubledBoard)).toBe(
      `GitHub budget 0 of 5,000, reading less often until ${at("2026-11-05T20:12:00Z")}`
    )
    expect(budgetText(quietBoard)).toBeNull()
    const budget = {
      remaining: Count.make(900),
      limit: Count.make(5000),
      resetAt: IsoTime.make("2026-11-05T20:12:00Z"),
      slowed: false
    }
    expect(budgetText({ ...busyBoard, budget })).toBe("GitHub budget 900 of 5,000")
  })
})
