import { describe, expect, it } from "@effect/vitest"
import type { Card } from "@review-desk/contract/Board.ts"
import { architectureCard } from "@review-desk/contract/Sample.testing.ts"
import { IsoTime, PrNumber, Text } from "@review-desk/contract/Ids.ts"
import { Branch } from "./Facts.ts"
import { otherKey, pull } from "./Facts.testing.ts"
import { readyOrder, relationsOf } from "./Relations.ts"

describe("how pull requests relate", () => {
  it("finds stacks, conflicts and stated dependencies among open pull requests in the same repository", () => {
    const parent = pull(10, { head: Branch.make("auth-base"), files: [Text.make("a.ts")] })
    const child = pull(11, {
      base: Branch.make("auth-base"),
      files: [Text.make("b.ts")],
      body: Text.make("Depends on #12")
    })
    const clashing = pull(12, { files: [Text.make("b.ts")], mergeable: "no" })
    const merged = pull(13, { state: "merged", head: Branch.make("auth-base") })

    expect(relationsOf(child, [parent, child, clashing, merged])).toEqual([
      { kind: "stacked-on", with: parent.key, label: "acme/api#10" },
      { kind: "conflicts-with", with: clashing.key, label: "acme/api#12" },
      { kind: "depends-on", with: clashing.key, label: "acme/api#12" }
    ])
    expect(relationsOf(parent, [parent, child])).toEqual([])
  })
})

const readyCard = (
  number: number,
  verdict: "architecture" | "look" | "skim" | null,
  minute: number,
  stackedOn?: number
): Card => ({
  ...architectureCard,
  key: otherKey(number),
  number: PrNumber.make(number),
  stage: "ready",
  role: "reviewer",
  triage: verdict === null ? null : { verdict, reason: Text.make("why") },
  relations:
    stackedOn === undefined
      ? []
      : [{ kind: "stacked-on", with: otherKey(stackedOn), label: Text.make(`#${stackedOn}`) }],
  updatedAt: IsoTime.make(`2026-11-05T10:${String(minute).padStart(2, "0")}:00Z`)
})

describe("the order of the ready queue", () => {
  it("puts architectural questions first, then stack order, then the oldest first", () => {
    const cards = [
      readyCard(1, "skim", 1),
      readyCard(2, "architecture", 5),
      readyCard(3, "look", 9, 4),
      readyCard(4, "look", 20),
      readyCard(5, null, 2)
    ]
    expect(readyOrder(cards).map((key) => key.split("#")[1])).toEqual(["2", "5", "4", "3", "1"])
  })

  it("ignores cards that are not ready for you, and survives a stacking loop", () => {
    const loop = [
      readyCard(1, "look", 1, 2),
      readyCard(2, "look", 2, 1),
      { ...readyCard(3, "skim", 3), role: "author" as const }
    ]
    expect(readyOrder(loop)).toHaveLength(2)
    expect(readyOrder([readyCard(1, "look", 1, 99)])).toEqual([otherKey(1)])
  })
})
