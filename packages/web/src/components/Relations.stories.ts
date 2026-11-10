import type { Meta, StoryObj } from "@storybook/html-vite"
import { PrKey, Text } from "@review-desk/contract/Ids.ts"
import { expect, within } from "storybook/test"
import { story } from "../stories/harness.testing.ts"
import { RelationList } from "./Relations.ts"

const meta: Meta = { title: "Card parts/Relations" }

export default meta

const other = (n: number) => ({ with: PrKey.make(`github:acme/api#${n}`), label: Text.make(`acme/api#${n}`) })

export const EveryKind: StoryObj = {
  render: story((h) =>
    RelationList(h, {
      relations: [
        { kind: "stacked-on", ...other(209) },
        { kind: "conflicts-with", ...other(215) },
        { kind: "depends-on", ...other(199) }
      ]
    })
  ),
  play: async ({ canvasElement }) => {
    const list = await within(canvasElement).findByRole("list", { name: "Related pull requests" })
    const items = within(list).getAllByRole("listitem")
    await expect(items.map((item) => item.textContent)).toEqual([
      "Stacked on acme/api#209",
      "Conflicts with acme/api#215",
      "Merge after acme/api#199"
    ])
  }
}

export const None: StoryObj = {
  render: story((h) => h.div([], [RelationList(h, { relations: [] }), "end"])),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText("end")
    await expect(canvas.queryByRole("list")).toBeNull()
  }
}
