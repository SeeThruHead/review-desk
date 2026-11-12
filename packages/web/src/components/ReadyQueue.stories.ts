import type { Meta, StoryObj } from "@storybook/html-vite"
import { architectureCard, lookCard, skimCard } from "@review-desk/contract/Sample.testing.ts"
import { expect, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { PullCard } from "./PullCard.ts"
import { ReadyQueue, VerdictGroup } from "./ReadyQueue.ts"

const meta: Meta = { title: "Board/Needs you queue" }

export default meta

export const Grouped: StoryObj = {
  render: story((h) =>
    ReadyQueue(h, {
      count: 3,
      children: [
        VerdictGroup(h, {
          verdict: "architecture",
          children: [
            PullCard(h, {
              card: architectureCard,
              sidediff: true,
              onOpenInSidediff: logged("a"),
              settledOpen: false,
              onSettledChange: () => logged("settled")
            })
          ]
        }),
        VerdictGroup(h, {
          verdict: "look",
          children: [
            PullCard(h, {
              card: lookCard,
              sidediff: true,
              onOpenInSidediff: logged("l"),
              settledOpen: false,
              onSettledChange: () => logged("settled")
            })
          ]
        }),
        VerdictGroup(h, {
          verdict: "skim",
          children: [
            PullCard(h, {
              card: skimCard,
              sidediff: true,
              onOpenInSidediff: logged("s"),
              settledOpen: false,
              onSettledChange: () => logged("settled")
            })
          ]
        })
      ]
    })
  ),
  play: async ({ canvasElement }) => {
    const queue = within(await within(canvasElement).findByRole("complementary", { name: "Needs you" }))
    await expect(queue.getByRole("heading", { name: "Needs you, 3" })).toBeVisible()
    const groups = queue.getAllByRole("group", { name: /eye|look|skim/ })
    await expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual([
      "Needs your architectural eye",
      "Worth a real look",
      "Probably safe, skim it"
    ])
    await expect(
      within(groups[0] ?? canvasElement).getByRole("article", { name: architectureCard.title })
    ).toBeVisible()
  }
}

export const NothingWaiting: StoryObj = {
  render: story((h) => ReadyQueue(h, { count: 0, children: [] })),
  play: async ({ canvasElement }) => {
    const queue = within(await within(canvasElement).findByRole("complementary", { name: "Needs you" }))
    await expect(queue.getByText("Nothing needs you right now. The agents are on it.")).toBeVisible()
  }
}
