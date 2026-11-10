import type { Meta, StoryObj } from "@storybook/html-vite"
import {
  architectureCard,
  awaitingThemCard,
  reviewingCard,
  talkingCard,
  theirTurnCard,
  untrustedCard,
  waitingCard
} from "@review-desk/contract/Sample.testing.ts"
import type { Card } from "@review-desk/contract/Board.ts"
import { Url } from "@review-desk/contract/Ids.ts"
import { expect, userEvent, waitFor, within } from "storybook/test"
import { logged, story } from "../stories/harness.testing.ts"
import { PullCard } from "./PullCard.ts"

const meta: Meta = { title: "Board/Pull card" }

export default meta

const card = (value: Card, sidediff = true) =>
  story((h) =>
    h.div(
      [h.Style({ maxWidth: "420px" })],
      [
        PullCard(h, {
          card: value,
          sidediff,
          onOpenInSidediff: logged(`sidediff ${value.key}`),
          settledOpen: false,
          onSettledChange: () => logged("settled")
        })
      ]
    )
  )

const article = async (canvasElement: HTMLElement, title: string) =>
  within(await within(canvasElement).findByRole("article", { name: title }))

export const ReadyWithVerdict: StoryObj = {
  render: card(architectureCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, architectureCard.title)
    await expect(pull.getByText("acme/api#212")).toBeVisible()
    await expect(pull.getByText("by lee")).toBeVisible()
    await expect(pull.getByText("Needs your architectural eye")).toBeVisible()
    await expect(pull.getByText(architectureCard.triage?.reason ?? "")).toBeVisible()
    await expect(pull.getByText("4 threads settled by agents")).toBeVisible()
    await expect(pull.getByText("Stacked on acme/api#209")).toBeVisible()
    await expect(pull.getByRole("link", { name: "Open on GitHub" })).toHaveAttribute("href", architectureCard.url)
  }
}

export const OpensInSidediff: StoryObj = {
  render: card(architectureCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, architectureCard.title)
    await userEvent.click(pull.getByRole("button", { name: "Open in sidediff" }))
    await waitFor(() =>
      expect(within(canvasElement).getByRole("log", { name: "Events" })).toHaveTextContent(
        `sidediff ${architectureCard.key}`
      )
    )
  }
}

export const WithoutSidediff: StoryObj = {
  render: card(architectureCard, false),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, architectureCard.title)
    await expect(pull.queryByRole("button", { name: "Open in sidediff" })).toBeNull()
  }
}

export const AgentReviewing: StoryObj = {
  render: card(reviewingCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, reviewingCard.title)
    await expect(pull.getByRole("status", { name: "auth session is working" })).toBeVisible()
    await expect(pull.getByText("CI running")).toBeVisible()
    await expect(pull.queryByText(/settled by agents/)).toBeNull()
  }
}

export const AgentsTalking: StoryObj = {
  render: card(talkingCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, talkingCard.title)
    await expect(pull.getByText("Your PR")).toBeVisible()
    await expect(pull.getByText("Round 2 of 3")).toBeVisible()
    await expect(pull.getByText("Your agent's turn")).toBeVisible()
    await expect(pull.getByText("3 open threads")).toBeVisible()
  }
}

export const TheirTurn: StoryObj = {
  render: card(theirTurnCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, theirTurnCard.title)
    await expect(pull.getByText("Their agent's turn")).toBeVisible()
    await expect(pull.getByRole("status", { name: "review-desk session is idle" })).toBeVisible()
  }
}

export const Untrusted: StoryObj = {
  render: card(untrustedCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, untrustedCard.title)
    await expect(pull.getByText("Untrusted: never sent to an agent")).toBeVisible()
    await expect(pull.getByText("You're reviewing")).toBeVisible()
    await expect(pull.queryByRole("status")).toBeNull()
  }
}

export const WaitingWithFailedCi: StoryObj = {
  render: card(waitingCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, waitingCard.title)
    await expect(pull.getByText("CI failed")).toBeVisible()
    await expect(pull.getByText("No agent yet")).toBeVisible()
  }
}

export const AwaitingTheirHuman: StoryObj = {
  render: card(awaitingThemCard),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, awaitingThemCard.title)
    await expect(pull.getByText("1 thread settled by agents")).toBeVisible()
    await expect(pull.queryByText("Needs your architectural eye")).toBeNull()
  }
}

export const OnGitea: StoryObj = {
  render: card({ ...awaitingThemCard, forge: "gitea", url: Url.make("https://gitea.example/you/sandbox/pulls/1") }),
  play: async ({ canvasElement }) => {
    const pull = await article(canvasElement, awaitingThemCard.title)
    await expect(pull.getByRole("link", { name: "Open on Gitea" })).toHaveAttribute(
      "href",
      "https://gitea.example/you/sandbox/pulls/1"
    )
    await expect(pull.queryByRole("link", { name: "Open on GitHub" })).toBeNull()
  }
}
