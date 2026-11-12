import type { Meta, StoryObj } from "@storybook/html-vite"
import { PrKey } from "@review-desk/contract/Ids.ts"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { NeedList } from "./NeedList.ts"

const meta: Meta = { title: "Board/Needs you" }

export default meta

export const TwoNeeds: StoryObj = {
  render: story((h) =>
    NeedList(h, {
      needs: [
        {
          key: PrKey.make("github:you/ui-kit#47"),
          title: "Focus ring on the menu items",
          url: "https://github.com/you/ui-kit/pull/47",
          place: "you/ui-kit#47",
          why: "Approved with CI passed: ready to merge"
        },
        {
          key: PrKey.make("github:acme/api#310"),
          title: "Webhook retries pile up after a deploy",
          url: "https://github.com/acme/api/issues/310",
          place: "acme/api#310",
          why: "sam mentioned you"
        }
      ],
      onSeen: (key) => logged(`seen ${key}`)
    })
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole("list", { name: "Also needs you, 2" })
    const first = within(within(list).getByRole("listitem", { name: "Focus ring on the menu items" }))
    await expect(first.getByRole("link", { name: "Focus ring on the menu items" })).toHaveAttribute(
      "href",
      "https://github.com/you/ui-kit/pull/47"
    )
    await expect(first.getByText("Approved with CI passed: ready to merge")).toBeVisible()
    await userEvent.click(canvas.getByRole("button", { name: "Mark Webhook retries pile up after a deploy seen" }))
    await waitFor(() =>
      expect(canvas.getByRole("log", { name: "Events" })).toHaveTextContent("seen github:acme/api#310")
    )
  }
}
