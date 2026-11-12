import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { Alert } from "./Alert.ts"

const meta: Meta = { title: "Board/Alert" }

export default meta

export const Dismissable: StoryObj = {
  render: story((h) => Alert(h, { tone: "error", text: "sidediff is not installed", onDismiss: logged("dismissed") })),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const alert = await canvas.findByRole("alert")
    await expect(alert).toHaveTextContent("sidediff is not installed")
    await userEvent.click(within(alert).getByRole("button", { name: "Dismiss" }))
    await waitFor(() => expect(canvas.getByRole("log", { name: "Events" })).toHaveTextContent("dismissed"))
  }
}

export const Lasting: StoryObj = {
  render: story((h) => Alert(h, { tone: "warning", text: "Lost the connection to your desk." })),
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole("alert")
    await expect(within(alert).queryByRole("button")).toBeNull()
  }
}

export const Info: StoryObj = {
  render: story((h) => Alert(h, { tone: "info", text: "Routing off: No areas configured." })),
  play: async ({ canvasElement }) => {
    const status = await within(canvasElement).findByRole("status")
    await expect(status).toHaveTextContent("Routing off: No areas configured.")
  }
}
