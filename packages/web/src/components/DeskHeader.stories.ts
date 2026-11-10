import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { DeskHeader } from "./DeskHeader.ts"

const meta: Meta = { title: "Board/Header" }

export default meta

export const Busy: StoryObj = {
  render: story((h) => DeskHeader(h, { desk: "dana", ready: 3, working: 2, polled: "Checked 15:42" })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("heading", { name: "Review Desk" })).toBeVisible()
    await expect(canvas.getByText("3 ready for you")).toBeVisible()
    await expect(canvas.getByText("2 agents working")).toBeVisible()
    await expect(canvas.getByText("Checked 15:42")).toBeVisible()
    await expect(canvas.getByText("dana")).toBeVisible()
  }
}

export const OneEach: StoryObj = {
  render: story((h) => DeskHeader(h, { desk: "dana", ready: 1, working: 1, polled: "Not checked yet" })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("1 ready for you")).toBeVisible()
    await expect(canvas.getByText("1 agent working")).toBeVisible()
  }
}
