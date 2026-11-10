import type { Meta, StoryObj } from "@storybook/html-vite"
import { talkingCard } from "@review-desk/contract/Sample.testing.ts"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { ThreadBoard } from "./ThreadBoard.ts"

const meta: Meta = { title: "Queue/Thread board" }

export default meta

export const EveryColumn: StoryObj = {
  render: story((h) => ThreadBoard(h, { threads: talkingCard.threads ?? [] })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const column = (name: string) => within(canvas.getByRole("list", { name }))
    await canvas.findByRole("list", { name: "Open, 2" })
    await expect(
      column("Open, 2")
        .getAllByRole("listitem")
        .map((item) => item.querySelector("code")?.textContent)
    ).toEqual(["src/Popover/focus.ts", "src/Popover/Popover.ts"])
    await expect(column("Open, 2").getByText("Your agent's turn, round 2")).toBeVisible()
    await expect(column("Open, 2").getByText("Their agent's turn, round 1")).toBeVisible()
    await expect(column("Left for you, 1").getByText("We disagree on whether Escape should return focus")).toBeVisible()
    await expect(column("Settled, 1").getByText("Fixed")).toBeVisible()
  }
}

export const NoThreads: StoryObj = {
  render: story((h) => ThreadBoard(h, { threads: [] })),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No agent threads yet")).toBeVisible()
  }
}
