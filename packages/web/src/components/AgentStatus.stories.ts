import type { Meta, StoryObj } from "@storybook/html-vite"
import { SessionName } from "@review-desk/contract/Ids.ts"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { AgentStatus } from "./AgentStatus.ts"

const meta: Meta = { title: "Card parts/Agent status" }

export default meta

export const Working: StoryObj = {
  render: story((h) => AgentStatus(h, { agent: { session: SessionName.make("auth"), working: true } })),
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement).findByRole("status")
    await expect(status).toHaveAccessibleName("auth session is working")
    await expect(status).toHaveTextContent("auth is working")
  }
}

export const Idle: StoryObj = {
  render: story((h) => AgentStatus(h, { agent: { session: SessionName.make("ui-kit"), working: false } })),
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement).findByRole("status")
    await expect(status).toHaveAccessibleName("ui-kit session is idle")
  }
}

export const NoAgent: StoryObj = {
  render: story((h) => AgentStatus(h, { agent: null })),
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement).findByRole("status")
    await expect(status).toHaveTextContent("No agent yet")
  }
}
