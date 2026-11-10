import type { Card, Relation, Verdict } from "@review-desk/contract/Board.ts"
import { type PrKey, Text } from "@review-desk/contract/Ids.ts"
import type { PullFacts } from "./Facts.ts"

const label = (pull: PullFacts): Text => Text.make(`${pull.repo}#${pull.number}`)

const sameRepo = (a: PullFacts, b: PullFacts): boolean => a.forge === b.forge && a.repo === b.repo && a.key !== b.key

const dependsPattern = /depends on #(\d+)/gi

const dependsOnNumbers = (pull: PullFacts): ReadonlyArray<number> =>
  [...pull.body.matchAll(dependsPattern)].map((match) => Number(match[1]))

const sharesFiles = (a: PullFacts, b: PullFacts): boolean => a.files.some((file) => b.files.includes(file))

const conflicts = (a: PullFacts, b: PullFacts): boolean =>
  sharesFiles(a, b) && (a.mergeable === "no" || b.mergeable === "no")

export const relationsOf = (pull: PullFacts, all: ReadonlyArray<PullFacts>): ReadonlyArray<Relation> => {
  const others = all.filter((other) => sameRepo(pull, other) && other.state === "open")

  return [
    ...others
      .filter((other) => other.head === pull.base)
      .map((other) => ({ kind: "stacked-on" as const, with: other.key, label: label(other) })),
    ...others
      .filter((other) => conflicts(pull, other))
      .map((other) => ({ kind: "conflicts-with" as const, with: other.key, label: label(other) })),
    ...others
      .filter((other) => dependsOnNumbers(pull).includes(other.number))
      .map((other) => ({ kind: "depends-on" as const, with: other.key, label: label(other) }))
  ]
}

const verdictRank: { readonly [V in Verdict]: number } = { architecture: 0, look: 1, skim: 2 }

const depth = (card: Card, byKey: ReadonlyMap<PrKey, Card>, seen: ReadonlySet<PrKey>): number => {
  const parent = card.relations.find((relation) => relation.kind === "stacked-on")
  if (parent === undefined) return 0
  const above = byKey.get(parent.with)
  if (above === undefined || seen.has(above.key)) return 1

  return 1 + depth(above, byKey, new Set([...seen, card.key]))
}

export const readyOrder = (cards: ReadonlyArray<Card>): ReadonlyArray<PrKey> => {
  const byKey = new Map(cards.map((card) => [card.key, card]))

  return cards
    .filter((card) => card.stage === "ready" && card.role === "reviewer")
    .map((card) => ({
      card,
      verdict: verdictRank[card.triage?.verdict ?? "look"],
      depth: depth(card, byKey, new Set())
    }))
    .toSorted((a, b) => a.verdict - b.verdict || a.depth - b.depth || a.card.updatedAt.localeCompare(b.card.updatedAt))
    .map((entry) => entry.card.key)
}
