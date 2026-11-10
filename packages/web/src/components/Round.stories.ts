import type { Meta, StoryObj } from "@storybook/html-vite"
import { Count } from "@review-desk/contract/Ids.ts"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { RoundBadge } from "./Round.ts"

const meta: Meta = { title: "Card parts/Round" }

export default meta

export const YourAgentsTurn: StoryObj = {
  render: story((h) => RoundBadge(h, { round: { number: Count.make(2), limit: Count.make(3), turn: "mine" } })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Round 2 of 3")).toBeVisible()
    await expect(canvas.getByText("Your agent's turn")).toBeVisible()
  }
}

export const TheirAgentsTurn: StoryObj = {
  render: story((h) => RoundBadge(h, { round: { number: Count.make(3), limit: Count.make(3), turn: "theirs" } })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Round 3 of 3, last round")).toBeVisible()
    await expect(canvas.getByText("Their agent's turn")).toBeVisible()
  }
}
