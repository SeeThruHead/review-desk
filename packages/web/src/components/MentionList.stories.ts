import type { Meta, StoryObj } from "@storybook/html-vite"
import { issueMention, pullMention } from "@review-desk/contract/Sample.testing.ts"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { MentionList } from "./MentionList.ts"

const meta: Meta = { title: "Board/Mentions" }

export default meta

export const Mentions: StoryObj = {
  render: story((h) =>
    MentionList(h, {
      mentions: [issueMention, pullMention],
      time: () => "15:05",
      onSeen: (key) => logged(`seen ${key}`)
    })
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const list = await canvas.findByRole("list", { name: "Mentions" })
    await expect(
      within(list).getByText("Text from other people, shown to you only; it never reaches an agent.")
    ).toBeVisible()
    const issue = within(within(list).getByRole("listitem", { name: issueMention.title }))
    await expect(issue.getByText("acme/api#310, issue, sam at 15:05")).toBeVisible()
    await expect(issue.getByText(issueMention.text)).toBeVisible()
    const pull = within(within(list).getByRole("listitem", { name: pullMention.title }))
    await expect(pull.getByText("acme/web#77, pull request, lee at 15:05")).toBeVisible()
    await expect(pull.queryByRole("button")).toBeNull()
    await userEvent.click(issue.getByRole("button", { name: `Mark ${issueMention.title} seen` }))
    await waitFor(() =>
      expect(canvas.getByRole("log", { name: "Events" })).toHaveTextContent(`seen ${issueMention.key}`)
    )
  }
}
