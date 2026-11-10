import { describe, expect, it } from "@effect/vitest"
import {
  busyBoard,
  lookCard,
  mergedCard,
  quietBoard,
  reviewingCard,
  talkingCard
} from "@review-desk/contract/Sample.testing.ts"
import { Text } from "@review-desk/contract/Ids.ts"
import { Command, given, message, model, story } from "foldkit/story"
import { OpenInSidediff } from "./commands.ts"
import { Message } from "./message.ts"
import { connecting, polledText, readyCount, readyGroups, sectionsOf, workingCount } from "./model.ts"
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
      ["working", [218, 41]],
      ["queue", [7, 43, 90, 3, 86]],
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
    expect(readyGroups({ ...quietBoard, cards: [{ ...reviewingCard, stage: "ready", triage: null }] })).toEqual([
      { verdict: "look", cards: [{ ...reviewingCard, stage: "ready", triage: null }] }
    ])
  })

  it("says when the desk last checked, or that it has not yet", () => {
    expect(polledText({ ...busyBoard, polledAt: null })).toBe("Not checked yet")
    expect(polledText(busyBoard)).toMatch(/^Checked \d{1,2}:\d{2}/)
  })
})
