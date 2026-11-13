import { Effect, Schema } from "effect"

export type Status = "idle" | "working" | "blocked" | "unknown"

export type Found = {
  readonly pane: string
  readonly cwd: string
  readonly status: Status
  readonly name?: string
}

export type Step = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly stdin?: string
  readonly env?: Readonly<Record<string, string>>
}

export type Failure = { readonly message: string }

export type Run = (step: Step) => Effect.Effect<string, Failure>

export type Files = {
  readonly readText: (path: string) => Effect.Effect<string, Failure>
  readonly list: (directory: string) => Effect.Effect<ReadonlyArray<string>, Failure>
  readonly exists: (path: string) => Effect.Effect<boolean>
}

export type HostEnv = {
  readonly run: Run
  readonly files: Files
  readonly postLine: (socket: string, line: string) => Effect.Effect<void, Failure>
  readonly agentPrograms: ReadonlySet<string>
}

export type Target = { readonly id: string; readonly machine: string | null }

export type AgentHost = {
  readonly name: string
  readonly title: string
  readonly yieldsToTerminals: boolean
  readonly list: (env: HostEnv) => Effect.Effect<ReadonlyArray<Found>, Failure>
  readonly send: (env: HostEnv, target: Target, text: string) => Effect.Effect<void, Failure>
  readonly read: (env: HostEnv, target: Target, lines: number) => Effect.Effect<string, Failure>
}

export type CommandHost = {
  readonly name: string
  readonly title: string
  readonly list: (env: HostEnv) => Effect.Effect<ReadonlyArray<Found>, Failure>
  readonly steps: (target: Target, text: string) => ReadonlyArray<Step>
  readonly screen: (target: Target, lines: number) => Step
}

export const lastLines = (text: string, lines: number): string => text.trimEnd().split("\n").slice(-lines).join("\n")

export const commandHost = (host: CommandHost): AgentHost & CommandHost => ({
  ...host,
  yieldsToTerminals: false,
  send: (env, target, text) => Effect.forEach(host.steps(target, text), env.run, { discard: true }),
  read: (env, target, lines) => Effect.map(env.run(host.screen(target, lines)), (text) => lastLines(text, lines))
})

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

const pasteStart = "\u001b[200~"
const pasteEnd = "\u001b[201~"

export const bracketed = (text: string): string => `${pasteStart}${text}${pasteEnd}`

export const bufferName = (id: string): string => `review-desk-${id.replace(/\W/g, "")}`
