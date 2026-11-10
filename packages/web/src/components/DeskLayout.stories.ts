import type { Meta, StoryObj } from "@storybook/html-vite"
import { expect, within } from "storybook/test"
import * as ScrollArea from "@seethruhead/sth-ui/core/components/ScrollArea/model.ts"
import { logged, story } from "../stories/harness.testing.ts"
import { ui } from "../theme/ui.ts"
import { DeskLayout } from "./DeskLayout.ts"

const meta: Meta = { title: "Queue/Layout" }

export default meta

export const SidebarStaysPut: StoryObj = {
  render: story(
    (h) =>
      DeskLayout(h, {
        header: "header",
        alerts: ["alert"],
        main: ["main content"],
        sidebar: "sidebar",
        sidebarScroll: { model: ScrollArea.init({ id: "story-sidebar" }), toParentMessage: () => logged("scrolled") }
      }),
    { padded: false }
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const main = await canvas.findByRole("main")
    await expect(main).toHaveTextContent("main content")
    const side = canvas.getByText("sidebar")
    await expect(Math.round(side.getBoundingClientRect().width)).toBe(400)
    await expect(canvas.getByText("header")).toBeVisible()
  }
}

const longTitle = `${"A pull request title that goes on and on without a break ".repeat(6)}end`

export const LongTitlesKeepTheSidebarBeside: StoryObj = {
  render: story(
    (h) =>
      DeskLayout(h, {
        header: "header",
        alerts: [],
        main: [ui.Text(h, { truncate: true, children: [longTitle] })],
        sidebar: "sidebar",
        sidebarScroll: { model: ScrollArea.init({ id: "story-sidebar" }), toParentMessage: () => logged("scrolled") }
      }),
    { padded: false }
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const main = (await canvas.findByRole("main")).getBoundingClientRect()
    const side = canvas.getByText("sidebar").getBoundingClientRect()
    await expect(side.left).toBeGreaterThanOrEqual(main.right)
    await expect(side.top).toBeLessThan(main.bottom)
  }
}
