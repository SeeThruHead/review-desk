import { parseAddress } from "../agents/Address.ts"

export const placeOf = (machine: string | null, host: string): string => `${machine ?? "local"}/${host}`

export type Seen = { readonly name: string; readonly machine: string | null; readonly pane: string }

export type Roster = {
  readonly agents: ReadonlyArray<Seen>
  readonly reached: ReadonlyArray<string>
  readonly complete: boolean
  readonly prefixes: ReadonlyArray<string>
}

export const unknownRoster: Roster = { agents: [], reached: [], complete: false, prefixes: [] }

export type Holder =
  | { readonly _tag: "Session"; readonly key: string; readonly session: string }
  | { readonly _tag: "Pane"; readonly key: string; readonly machine: string | null; readonly pane: string }

export type Sighting = "present" | "gone" | "unknown"

const sessionSighting = (session: string, roster: Roster): Sighting => {
  if (roster.agents.some((agent) => agent.name === session || agent.pane === session)) return "present"

  return roster.complete ? "gone" : "unknown"
}

const paneSighting = (machine: string | null, pane: string, roster: Roster): Sighting => {
  if (roster.agents.some((agent) => agent.machine === machine && agent.pane === pane)) return "present"

  return roster.reached.includes(placeOf(machine, parseAddress(pane, roster.prefixes).host)) ? "gone" : "unknown"
}

export const sightingOf = (holder: Holder, roster: Roster): Sighting =>
  holder._tag === "Session"
    ? sessionSighting(holder.session, roster)
    : paneSighting(holder.machine, holder.pane, roster)

export type Absence = { readonly missing: ReadonlyMap<string, number>; readonly expired: ReadonlyArray<Holder> }

type Judged = { readonly holder: Holder; readonly sighting: Sighting; readonly since: number | undefined }

const missingSince = (judged: Judged, nowMillis: number): ReadonlyArray<readonly [string, number]> => {
  if (judged.sighting === "present") return []
  if (judged.sighting === "gone") return [[judged.holder.key, judged.since ?? nowMillis]]

  return judged.since === undefined ? [] : [[judged.holder.key, judged.since]]
}

const expiredAt = (judged: Judged, nowMillis: number, graceMillis: number): boolean => {
  if (judged.sighting !== "gone") return false
  if (judged.since === undefined) return false

  return nowMillis - judged.since >= graceMillis
}

export const absences = (
  holders: ReadonlyArray<Holder>,
  roster: Roster,
  before: ReadonlyMap<string, number>,
  nowMillis: number,
  graceMillis: number
): Absence => {
  const judged = holders.map((holder) => ({
    holder,
    sighting: sightingOf(holder, roster),
    since: before.get(holder.key)
  }))
  const expired = judged.filter((one) => expiredAt(one, nowMillis, graceMillis))
  const gone = new Set(expired.map((one) => one.holder.key))

  return {
    missing: new Map(judged.flatMap((one) => missingSince(one, nowMillis)).filter(([key]) => !gone.has(key))),
    expired: expired.map((one) => one.holder)
  }
}
