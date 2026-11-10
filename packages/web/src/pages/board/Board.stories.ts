import type { Meta, StoryObj } from "@storybook/html-vite"
import { architectureCard, busyBoard, quietBoard, talkingCard } from "@review-desk/contract/Sample.testing.ts"
import { SidediffFailed, type NotConfigured, type UnknownPull } from "@review-desk/contract/Contract.ts"
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

export const Busy: StoryObj = {
  render: renderPage({ watchBoard: boardStream(busyBoard), openInSidediff: opens }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText("3 ready for you")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Review Desk" })).toBeVisible()
    await expect(page.getByText("2 agents working")).toBeVisible()
    const sidebar = within(page.getByRole("complementary", { name: "Ready for you" }))
    await expect(sidebar.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
      "Move session refresh into the request middleware",
      "Paginate the audit log export",
      "Rename the settings route constants"
    ])
    const rows = (name: string) =>
      within(page.getByRole("region", { name }))
        .getAllByRole("button", { expanded: false })
        .map((button) => button.querySelector("[data-title]")?.textContent)
    await expect(rows("Agents working now")).toEqual([
      "Add rate limits to the login endpoint",
      "Popover keeps focus inside while open"
    ])
    await expect(rows("In the queue")).toEqual([
      "Trust gate for untrusted repositories",
      "Tooltip arrow follows the anchor",
      "Dark mode for the billing page",
      "Please run this setup script",
      "Split the invoice table into rows"
    ])
    await expect(rows("History")).toEqual(["Drop the legacy webhook signature", "Poll Gitea as well as GitHub"])
  }
}

export const ExpandingARow: StoryObj = {
  render: renderPage({ watchBoard: boardStream(busyBoard), openInSidediff: opens }),
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
  render: renderPage({ watchBoard: boardStream(busyBoard), openInSidediff: opens }, { expanded: [talkingCard.key] }),
  play: async ({ canvasElement }) => {
    const details = within(await within(canvasElement).findByRole("region", { name: new RegExp(talkingCard.title) }))
    await expect(details.getByRole("list", { name: "Open, 2" })).toBeVisible()
  }
}

export const Quiet: StoryObj = {
  render: renderPage({ watchBoard: boardStream(quietBoard), openInSidediff: opens }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByText("Nothing needs you right now. The agents are on it.")).toBeVisible()
    await expect(page.getByText("0 agents working")).toBeVisible()
  }
}

export const Connecting: StoryObj = {
  render: renderPage({ watchBoard: Stream.never, openInSidediff: opens }),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Connecting to your desk")).toBeVisible()
  }
}

export const DeskStopped: StoryObj = {
  render: renderPage({
    watchBoard: Stream.concat(Stream.make(busyBoard), Stream.fail(new DeskOffline())),
    openInSidediff: opens
  }),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(await page.findByRole("alert")).toHaveTextContent(
      "Lost the connection to your desk. Showing the last board; reconnecting."
    )
    await expect(page.getByRole("complementary", { name: "Ready for you" })).toBeVisible()
  }
}

export const SidediffFails: StoryObj = {
  render: renderPage({ watchBoard: boardStream(busyBoard), openInSidediff: fails }),
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
  render: renderPage({ watchBoard: boardStream(busyBoard), openInSidediff: opens }),
  globals: { viewport: { value: "phone" } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const queue = await page.findByRole("complementary", { name: "Ready for you" })
    await expect(queue).toBeVisible()
  }
}
