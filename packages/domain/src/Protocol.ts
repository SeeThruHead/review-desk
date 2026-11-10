import type { Outcome } from "@review-desk/contract/Board.ts"
import { Count, Login, Text } from "@review-desk/contract/Ids.ts"
import { Option, Schema } from "effect"
import { Side } from "./Facts.ts"

export const MarkerOutcome = Schema.Literals(["open", "fixed", "answered", "dropped"])
export type MarkerOutcome = typeof MarkerOutcome.Type

export const Marker = Schema.Struct({ side: Side, round: Count, outcome: MarkerOutcome, desk: Login })
export type Marker = typeof Marker.Type

const markerPattern =
  /<!--\s*review-desk v1 side=(reviewer|author) round=(\d+) outcome=(open|fixed|answered|dropped) desk=(\S+)\s*-->/

export const markerOf = (body: string): Option.Option<Marker> => {
  const found = markerPattern.exec(body)
  if (found === null) return Option.none()

  return Schema.decodeUnknownOption(Marker)({
    side: found[1],
    round: Number(found[2]),
    outcome: found[3],
    desk: found[4]
  })
}

export const isFromAgent = (body: string): boolean => Option.isSome(markerOf(body))

const labelFor = (side: Side, owner: string): string =>
  side === "reviewer" ? `AI agent review, not yet read by ${owner}` : `AI agent reply, not yet read by ${owner}`

export type Stamp = { readonly marker: Marker; readonly owner: string; readonly limit: number }

export const stamp = (input: Stamp, body: string): Text =>
  Text.make(
    [
      "> [!NOTE]",
      `> ${labelFor(input.marker.side, input.owner)}`,
      `> Review Desk, round ${input.marker.round} of ${input.limit}`,
      "",
      body.trim(),
      "",
      `<!-- review-desk v1 side=${input.marker.side} round=${input.marker.round} outcome=${input.marker.outcome} desk=${input.marker.desk} -->`
    ].join("\n")
  )

export const issueStamp = (owner: string, body: string): Text =>
  Text.make(
    ["> [!NOTE]", `> AI agent reply, not yet read by ${owner}`, "> Review Desk, on an issue", "", body.trim()].join(
      "\n"
    )
  )

export const plainText = (body: string): string =>
  body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .filter((line) => !line.startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

export const excerpt = (body: string, length = 160): string => {
  const flat = plainText(body)

  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

export const settledOutcome = (outcome: MarkerOutcome): Option.Option<Outcome> =>
  outcome === "open" ? Option.none() : Option.some(outcome)
