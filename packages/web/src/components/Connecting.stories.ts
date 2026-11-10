import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { Connecting } from "./Connecting.ts"

const meta: Meta = { title: "Board/Connecting" }

export default meta

export const Waiting: StoryObj = {
  render: story((h) => Connecting(h)),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Connecting to your desk")).toBeVisible()
  }
}
