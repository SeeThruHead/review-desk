import type { Meta, StoryObj } from "@storybook/html-vite"
import {
  architectureCard,
  busyBoard,
  issueMention,
  quietBoard,
  talkingCard,
  troubledBoard
} from "@review-desk/contract/Sample.testing.ts"
import { SidediffFailed, type NotConfigured, UnknownPull } from "@review-desk/contract/Contract.ts"
import { Text } from "@review-desk/contract/Ids.ts"
import type { Board } from "@review-desk/contract/Board.ts"
import { Effect, Stream } from "effect"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { renderPage } from "../../stories/page.testing.ts"
import { DeskOffline } from "./client.ts"

const meta: Meta = { title: "Pages/Board" }

export default meta

const boardStream = (board: Board) => Stream.concat(Stream.make(board), Stream.never)

const opens = () => Effect.void

const fails = (): Effect.Effect<void, SidediffFailed | UnknownPull | NotConfigured | DeskOffline> =>
  Effect.fail(new SidediffFailed({ key: architectureCard.key, reason: Text.make("sidediff is not installed") }))

const seen = () => Effect.void

const seenFails = (): Effect.Effect<void, UnknownPull | DeskOffline> =>
  Effect.fail(new UnknownPull({ key: issueMention.key }))

const desk = (board: Board, overrides: Partial<Parameters<typeof renderPage>[0]> = {}) => ({
  watchBoard: boardStream(board),
  openInSidediff: opens,
  markSeen: seen,
  ...overrides
})

export const Busy: StoryObj = {
  render: renderPage(desk(busyBoard)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText("6 need you")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Review Desk" })).toBeVisible()
    await expect(page.getByText("2 agents working")).toBeVisible()
    await expect(page.getByText("GitHub budget 4,210 of 5,000")).toBeVisible()
    await expect(page.queryByRole("alert")).toBeNull()
    await expect(page.queryByText(/^Routing/)).toBeNull()
    const sidebar = within(page.getByRole("complementary", { name: "Needs you" }))
    await expect(sidebar.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Move session refresh into the request middleware",
      "Paginate the audit log export",
      "Rename the settings route constants"
    ])
    const others = within(sidebar.getByRole("list", { name: "Also needs you, 3" }))
    await expect(others.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Webhook retries pile up after a deploy",
      "Focus ring on the menu items",
      "Tooltip arrow follows the anchor"
    ])
    const rows = (name: string) =>
      within(page.getByRole("region", { name }))
        .getAllByRole("button", { expanded: false })
        .map((button) => button.querySelector("[data-title]")?.textContent)
    await expect(rows("Reviewing")).toEqual(["Add rate limits to the login endpoint", "Please run this setup script"])
    await expect(rows("Your pull requests")).toEqual([
      "Popover keeps focus inside while open",
      "Trust gate for untrusted repositories",
      "Cache the plan lookups",
      "Focus ring on the menu items",
      "Tooltip arrow follows the anchor",
      "Dark mode for the billing page",
      "Split the invoice table into rows"
    ])
    const mentions = within(page.getByRole("region", { name: "Mentions" }))
    await expect(mentions.getAllByRole("listitem").map((item) => item.getAttribute("aria-label"))).toEqual([
      "Webhook retries pile up after a deploy",
      "Move the footer links into the nav"
    ])
    await expect(rows("History")).toEqual(["Drop the legacy webhook signature", "Poll Gitea as well as GitHub"])
  }
}

export const ExpandingARow: StoryObj = {
  render: renderPage(desk(busyBoard)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const toggle = await page.findByRole("button", { name: /Popover keeps focus inside while open/ })
    await userEvent.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
    const details = within(await page.findByRole("region", { name: /Popover keeps focus inside while open/ }))
    await expect(details.getByRole("list", { name: "Left for you, 1" })).toBeVisible()
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(page.queryByRole("region", { name: /Popover keeps focus inside while open/ })).toBeNull()
    )
    toggle.focus()
    await userEvent.keyboard("{Enter}")
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"))
    await userEvent.keyboard(" ")
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"))
  }
}

export const WithARowOpen: StoryObj = {
  render: renderPage(desk(busyBoard), { expanded: [talkingCard.key] }),
  play: async ({ canvasElement }) => {
    const details = within(await within(canvasElement).findByRole("region", { name: new RegExp(talkingCard.title) }))
    await expect(details.getByRole("list", { name: "Open, 2" })).toBeVisible()
  }
}

export const Quiet: StoryObj = {
  render: renderPage(desk(quietBoard)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText("Nothing needs you right now. The agents are on it.")).toBeVisible()
    await expect(page.getByText("0 agents working")).toBeVisible()
  }
}

export const Connecting: StoryObj = {
  render: renderPage(desk(busyBoard, { watchBoard: Stream.never })),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Connecting to your desk")).toBeVisible()
  }
}

export const DeskStopped: StoryObj = {
  render: renderPage(
    desk(busyBoard, { watchBoard: Stream.concat(Stream.make(busyBoard), Stream.fail(new DeskOffline())) })
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Lost the connection to your desk. Showing the last board; reconnecting."
    )
    await expect(page.getByRole("complementary", { name: "Needs you" })).toBeVisible()
  }
}

export const SidediffFails: StoryObj = {
  render: renderPage(desk(busyBoard, { openInSidediff: fails })),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const card = within(await page.findByRole("article", { name: architectureCard.title }))
    await userEvent.click(card.getByRole("button", { name: "Open in sidediff" }))
    const alert = await page.findByRole("alert")
    await expect(alert).toHaveTextContent("sidediff could not open github:acme/api#212: sidediff is not installed")
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }))
    await waitFor(() => expect(page.queryByRole("alert")).toBeNull())
  }
}

export const Phone: StoryObj = {
  render: renderPage(desk(busyBoard)),
  globals: { viewport: { value: "phone" } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const queue = await page.findByRole("complementary", { name: "Needs you" })
    await expect(queue).toBeVisible()
  }
}

export const StaleAndRoutingOff: StoryObj = {
  render: renderPage(desk(troubledBoard)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const alert = await page.findByRole("alert")
    await expect(alert).toHaveTextContent(
      /^Paused: GitHub's rate limit for this account is spent, reading again at .+\. Showing what was read at .+\.$/
    )
    await expect(page.getByText("Routing off: No areas configured, so review requests stay with you.")).toBeVisible()
    await expect(page.getByText(/^GitHub budget 0 of 5,000, reading less often until /)).toBeVisible()
  }
}

export const StaleBeforeAnyRead: StoryObj = {
  render: renderPage(
    desk({
      ...quietBoard,
      health: { state: "stale", reason: Text.make("github did not answer"), lastGood: null, until: null },
      routing: { on: true, reason: Text.make("No area covers acme/web, so review requests there stay with you") }
    })
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Nothing read from GitHub yet: github did not answer."
    )
    await expect(
      page.getByText("Routing: No area covers acme/web, so review requests there stay with you.")
    ).toBeVisible()
  }
}

export const MarkingSeen: StoryObj = {
  render: renderPage(desk(busyBoard)),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText("6 need you")).toBeVisible()
    const sidebar = within(page.getByRole("complementary", { name: "Needs you" }))
    await userEvent.click(sidebar.getByRole("button", { name: `Mark ${issueMention.title} seen` }))
    await expect(page.queryByRole("alert")).toBeNull()
  }
}

export const MarkingSeenFails: StoryObj = {
  render: renderPage(desk(busyBoard, { markSeen: seenFails })),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const mentions = within(await page.findByRole("region", { name: "Mentions" }))
    await userEvent.click(mentions.getByRole("button", { name: `Mark ${issueMention.title} seen` }))
    await expect(await page.findByRole("alert")).toHaveTextContent(/Review Desk is not watching github:acme\/api#310/)
  }
}
