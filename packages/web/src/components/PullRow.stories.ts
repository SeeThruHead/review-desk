import type { Meta, StoryObj } from "@storybook/html-vite"
import type { Card } from "@review-desk/contract/Board.ts"
import {
  architectureCard,
  awaitingThemCard,
  mergedCard,
  reviewedCard,
  reviewingCard,
  talkingCard,
  theirTurnCard,
  untrustedCard,
  waitingCard
} from "@review-desk/contract/Sample.testing.ts"
import { IsoTime, SessionName, Text, Url } from "@review-desk/contract/Ids.ts"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { PullList } from "./PullRow.ts"
import { Section } from "./Section.ts"

const meta: Meta = { title: "Queue/Pull row" }

export default meta

const row = (card: Card, expanded: boolean) =>
  story((h) =>
    Section(h, {
      title: "Rows",
      hint: "",
      count: 1,
      children: [
        PullList(h, {
          id: "rows",
          cards: [card],
          expanded: expanded ? [card.key] : [],
          sidediff: true,
          onChange: () => logged(`toggle ${card.number}`),
          onOpenInSidediff: () => logged("sidediff")
        })
      ]
    })
  )

export const Collapsed: StoryObj = {
  render: row(talkingCard, false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole("button", { name: /Popover keeps focus inside while open/ })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(toggle).toHaveTextContent("you/ui-kit#41")
    await expect(toggle).toHaveTextContent("Agents talking, round 2 of 3, your agent's turn")
    await expect(toggle).toHaveTextContent("ui-kit")
    await expect(canvas.queryByRole("list", { name: "Open, 2" })).toBeNull()
    await userEvent.click(toggle)
    await waitFor(() => expect(canvas.getByRole("log", { name: "Events" })).toHaveTextContent("toggle 41"))
  }
}

export const Expanded: StoryObj = {
  render: row(talkingCard, true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: /Popover keeps focus/ })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    const details = within(canvas.getByRole("region", { name: /Popover keeps focus inside while open/ }))
    await expect(details.getByText("The reviewer's agent said")).toBeVisible()
    await expect(
      details.getByText("Focus still escapes on Shift+Tab from the first item", {
        selector: "blockquote, blockquote *"
      })
    ).toBeVisible()
    await expect(details.getByRole("list", { name: "Open, 2" })).toBeVisible()
    await expect(details.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", talkingCard.url)
    await expect(details.getByRole("status", { name: "ui-kit session is working" })).toBeVisible()
  }
}

export const Working: StoryObj = {
  render: row(reviewingCard, false),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /Add rate limits/ })
    await expect(toggle).toHaveTextContent("Agent reviewing")
    await expect(within(toggle).getByRole("img", { name: "An agent is working on it" })).toBeVisible()
  }
}

export const Waiting: StoryObj = {
  render: row(waitingCard, false),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /Tooltip arrow/ })
    await expect(toggle).toHaveTextContent("Waiting for review")
    await expect(toggle).toHaveTextContent("CI failed")
    await expect(within(toggle).getByRole("img", { name: "Waiting" })).toBeVisible()
  }
}

export const InHistory: StoryObj = {
  render: row(mergedCard, false),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /Poll Gitea as well as GitHub/ })
    await expect(toggle).toHaveTextContent("Merged")
    await expect(within(toggle).getByRole("img", { name: "Done" })).toBeVisible()
  }
}

export const Untrusted: StoryObj = {
  render: row(untrustedCard, true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: /Please run this setup script/ })).toHaveTextContent(
      "Untrusted"
    )
    const details = within(canvas.getByRole("region", { name: /Please run this setup script/ }))
    await expect(details.getByText("Untrusted: never sent to an agent")).toBeVisible()
    await expect(details.getByText("No agent threads yet")).toBeVisible()
  }
}

export const ExpandedWithVerdict: StoryObj = {
  render: row(architectureCard, true),
  play: async ({ canvasElement }) => {
    const details = within(
      await within(canvasElement).findByRole("region", { name: new RegExp(architectureCard.title) })
    )
    await expect(details.getByText("Needs your architectural eye")).toBeVisible()
    await expect(details.getByRole("list", { name: "Settled, 4" })).toBeVisible()
    await expect(details.getByText("Stacked on acme/api#209")).toBeVisible()
  }
}

export const AuthorSideOnGitea: StoryObj = {
  render: row(
    {
      ...awaitingThemCard,
      forge: "gitea",
      url: Url.make("https://gitea.example/you/sandbox/pulls/86"),
      activity: {
        side: "author",
        text: Text.make("Keyed the rows on their id"),
        at: IsoTime.make("2026-11-05T09:00:00Z")
      }
    },
    true
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: /Split the invoice table/ })).toHaveTextContent(
      "Ready for their review"
    )
    const details = within(canvas.getByRole("region", { name: /Split the invoice table/ }))
    await expect(details.getByText("The author's agent said")).toBeVisible()
    await expect(details.getByRole("link", { name: "Open on Gitea" })).toBeVisible()
    await expect(details.queryByRole("button", { name: "Open in sidediff" })).toBeVisible()
  }
}

export const HistoryRowOpen: StoryObj = {
  render: story((h) =>
    Section(h, {
      title: "Rows",
      hint: "",
      count: 2,
      children: [
        PullList(h, {
          id: "history",
          cards: [
            { ...reviewedCard, agent: { session: SessionName.make("old"), working: false } },
            { ...mergedCard, agent: { session: SessionName.make("old"), working: false } }
          ],
          expanded: [reviewedCard.key, mergedCard.key],
          sidediff: false,
          onChange: () => logged("t"),
          onOpenInSidediff: () => logged("s")
        })
      ]
    })
  ),
  play: async ({ canvasElement }) => {
    const details = within(await within(canvasElement).findByRole("region", { name: /Poll Gitea/ }))
    await expect(details.queryByRole("status")).toBeNull()
    await expect(details.queryByRole("button", { name: "Open in sidediff" })).toBeNull()
  }
}

export const TheirAgentsTurn: StoryObj = {
  render: row(theirTurnCard, false),
  play: async ({ canvasElement }) => {
    const toggle = await within(canvasElement).findByRole("button", { name: /Trust gate for untrusted repositories/ })
    await expect(toggle).toHaveTextContent("Agents talking, round 1 of 3, their agent's turn")
  }
}
