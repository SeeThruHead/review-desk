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

export type Stamp = {
  readonly marker: Marker
  readonly owner: string
  readonly limit: number
  readonly directed?: boolean
}

const directedLabel = ["> [!NOTE]", "> AI-formatted, real-human-directed", ""]

const humanComment = ["---", "**Human comment:**", ""]

const markerLine = (marker: Marker): string =>
  `<!-- review-desk v1 side=${marker.side} round=${marker.round} outcome=${marker.outcome} desk=${marker.desk} -->`

const agentStamp = (input: Stamp, body: string): Text =>
  Text.make(
    [
      "> [!NOTE]",
      `> ${labelFor(input.marker.side, input.owner)}`,
      `> Review Desk, round ${input.marker.round} of ${input.limit}`,
      "",
      body.trim(),
      "",
      markerLine(input.marker)
    ].join("\n")
  )

const directedStamp = (input: Stamp, body: string): Text =>
  Text.make([...directedLabel, body.trim(), "", markerLine(input.marker), "", ...humanComment].join("\n"))

export const stamp = (input: Stamp, body: string): Text =>
  input.directed === true ? directedStamp(input, body) : agentStamp(input, body)

const agentIssueStamp = (owner: string, body: string): Text =>
  Text.make(
    ["> [!NOTE]", `> AI agent reply, not yet read by ${owner}`, "> Review Desk, on an issue", "", body.trim()].join(
      "\n"
    )
  )

const directedIssueStamp = (body: string): Text =>
  Text.make([...directedLabel, body.trim(), "", ...humanComment].join("\n"))

export const issueStamp = (owner: string, body: string, options: { readonly directed?: boolean } = {}): Text =>
  options.directed === true ? directedIssueStamp(body) : agentIssueStamp(owner, body)

const isFrame = (line: string): boolean => line.startsWith(">") || line === "---" || line === "**Human comment:**"

export const plainText = (body: string): string =>
  body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split("\n")
    .filter((line) => !isFrame(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()

export const excerpt = (body: string, length = 160): string => {
  const flat = plainText(body)

  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

export const settledOutcome = (outcome: MarkerOutcome): Option.Option<Outcome> =>
  outcome === "open" ? Option.none() : Option.some(outcome)
