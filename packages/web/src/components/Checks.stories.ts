import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { ChecksBadge } from "./Checks.ts"

const meta: Meta = { title: "Card parts/Checks" }

export default meta

export const EveryState: StoryObj = {
  render: story((h) =>
    h.div(
      [h.Style({ display: "flex", gap: "8px" })],
      [
        ChecksBadge(h, { checks: "passed" }),
        ChecksBadge(h, { checks: "failed" }),
        ChecksBadge(h, { checks: "pending" }),
        ChecksBadge(h, { checks: "none" })
      ]
    )
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("CI passed")).toBeVisible()
    await expect(canvas.getByText("CI failed")).toBeVisible()
    await expect(canvas.getByText("CI running")).toBeVisible()
    await expect(canvas.queryByText("No CI")).toBeNull()
  }
}
