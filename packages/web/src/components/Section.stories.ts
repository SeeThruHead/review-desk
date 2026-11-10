import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { Section } from "./Section.ts"

const meta: Meta = { title: "Queue/Section" }

export default meta

export const WithRows: StoryObj = {
  render: story((h) =>
    Section(h, {
      title: "In the queue",
      hint: "Waiting on someone",
      count: 2,
      children: [h.li([], ["one"]), h.li([], ["two"])]
    })
  ),
  play: async ({ canvasElement }) => {
    const section = within(await within(canvasElement).findByRole("region", { name: "In the queue" }))
    await expect(section.getByRole("heading", { name: "In the queue 2" })).toBeVisible()
    await expect(section.getByText("Waiting on someone")).toBeVisible()
    await expect(section.getAllByRole("listitem")).toHaveLength(2)
  }
}

export const Empty: StoryObj = {
  render: story((h) => Section(h, { title: "History", hint: "Reviewed and merged", count: 0, children: [] })),
  play: async ({ canvasElement }) => {
    const section = within(await within(canvasElement).findByRole("region", { name: "History" }))
    await expect(section.getByText("Nothing here")).toBeVisible()
    await expect(section.queryByRole("list")).toBeNull()
  }
}
