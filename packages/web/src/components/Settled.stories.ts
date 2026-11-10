import type { Meta, StoryObj } from "@storybook/html-vite"
import { architectureCard } from "@review-desk/contract/Sample.testing.ts"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { SettledList } from "./Settled.ts"

const meta: Meta = { title: "Card parts/Settled threads" }

export default meta

const list = (settled: typeof architectureCard.settled, open: boolean) =>
  story((h) => SettledList(h, { id: "settled", settled, open, onChange: (next) => logged(next ? "opened" : "closed") }))

export const Collapsed: StoryObj = {
  render: list(architectureCard.settled, false),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const toggle = await canvas.findByRole("button", { name: "4 threads settled by agents" })
    await expect(toggle).toHaveAttribute("aria-expanded", "false")
    await expect(canvas.getByText("Retry no longer swallows the 401")).not.toBeVisible()
    await userEvent.click(toggle)
    await waitFor(() => expect(canvas.getByRole("log", { name: "Events" })).toHaveTextContent("opened"))
  }
}

export const Open: StoryObj = {
  render: list(architectureCard.settled, true),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole("button", { name: "4 threads settled by agents" })).toHaveAttribute(
      "aria-expanded",
      "true"
    )
    await expect(await canvas.findByText("Retry no longer swallows the 401")).toBeVisible()
    await expect(canvas.getByText("src/auth/cookie.ts")).toBeVisible()
    await expect(canvas.getAllByRole("listitem")).toHaveLength(4)
    await expect(canvas.getAllByText("Fixed")).toHaveLength(2)
    await expect(canvas.getByText("Answered")).toBeVisible()
    await expect(canvas.getByText("Dropped")).toBeVisible()
  }
}

export const OneThread: StoryObj = {
  render: list(architectureCard.settled.slice(0, 1), false),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("1 thread settled by agents")).toBeVisible()
  }
}

export const NothingSettled: StoryObj = {
  render: story((h) =>
    h.div([], [SettledList(h, { id: "settled", settled: [], open: false, onChange: () => logged("x") }), "end"])
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("end")
    await expect(canvas.queryByText(/settled by agents/)).toBeNull()
  }
}
