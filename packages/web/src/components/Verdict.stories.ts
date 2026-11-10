import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { VerdictBadge } from "./Verdict.ts"

const meta: Meta = { title: "Card parts/Verdict" }

export default meta

export const AllVerdicts: StoryObj = {
  render: story((h) =>
    h.div(
      [h.Style({ display: "flex", gap: "8px" })],
      [
        VerdictBadge(h, { verdict: "architecture" }),
        VerdictBadge(h, { verdict: "look" }),
        VerdictBadge(h, { verdict: "skim" })
      ]
    )
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText("Needs your architectural eye")).toBeVisible()
    await expect(canvas.getByText("Worth a real look")).toBeVisible()
    await expect(canvas.getByText("Probably safe, skim it")).toBeVisible()
  }
}
