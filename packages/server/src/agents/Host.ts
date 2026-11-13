import { Effect, Schema } from "effect"
import type { TerminalKind } from "./Address.ts"

export type Status = "idle" | "working" | "blocked" | "unknown"

export type Found = {
  readonly pane: string
  readonly cwd: string
  readonly status: Status
  readonly name?: string
}

export type Step = { readonly command: string; readonly args: ReadonlyArray<string>; readonly stdin?: string }

export type Failure = { readonly message: string }

export type Run = (step: Step) => Effect.Effect<string, Failure>

export type TerminalHost = {
  readonly kind: TerminalKind
  readonly title: string
  readonly list: (run: Run, agentPrograms: ReadonlySet<string>) => Effect.Effect<ReadonlyArray<Found>, Failure>
  readonly send: (id: string, machine: string | null, text: string) => ReadonlyArray<Step>
  readonly read: (id: string, machine: string | null, lines: number) => Step
}

export const knownAgentPrograms = ["claude", "codex", "opencode", "gemini", "pi", "amp", "aider", "cursor-agent"]

export const agentProgramsWith = (extra: ReadonlyArray<string> | undefined): ReadonlySet<string> =>
  new Set([...knownAgentPrograms, ...(extra ?? [])])

export const statusOf = (state: string | null | undefined): Status => {
  if (state === "idle" || state === "done") return "idle"
  if (state === "working" || state === "busy") return "working"
  if (state === "blocked") return "blocked"

  return "unknown"
}

export const decodeJson =
  <S extends Schema.Top & { readonly DecodingServices: never }>(schema: S) =>
  <E>(text: Effect.Effect<string, E>) =>
    Effect.flatMap(text, Schema.decodeUnknownEffect(Schema.fromJsonString(schema)))

export const lastLines = (text: string, lines: number): string => text.trimEnd().split("\n").slice(-lines).join("\n")

const pasteStart = "\u001b[200~"
const pasteEnd = "\u001b[201~"

export const bracketed = (text: string): string => `${pasteStart}${text}${pasteEnd}`

export const bufferName = (id: string): string => `review-desk-${id.replace(/\W/g, "")}`
