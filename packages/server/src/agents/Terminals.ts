import { Option, Schema } from "effect"

export type Found = {
  readonly pane: string
  readonly cwd: string
  readonly working: boolean
}

export const AppTerminal = Schema.Struct({
  address: Schema.String,
  agent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.NullOr(Schema.String))
})

export const AppTerminals = Schema.Struct({ terminals: Schema.Array(AppTerminal) })

const appAgent = (terminal: typeof AppTerminal.Type): ReadonlyArray<Found> => {
  if (!terminal.agent) return []
  if (terminal.agent.endsWith("-asleep")) return []
  if (terminal.state !== "live") return []
  if (!terminal.cwd) return []

  return [{ pane: `hc:${terminal.address}`, cwd: terminal.cwd, working: terminal.status === "working" }]
}

export const appAgents = (terminals: ReadonlyArray<typeof AppTerminal.Type>): ReadonlyArray<Found> =>
  terminals.flatMap(appAgent)

export const CmuxWorkspaces = Schema.Struct({ workspaces: Schema.Array(Schema.Struct({ id: Schema.String })) })

const sidebarAgents = ["claude_code", "codex", "opencode", "gemini"] as const

export const sidebarFields = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.indexOf("=") > 0)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const)
  )

export const cmuxAgent = (workspace: string, sidebar: ReadonlyMap<string, string>): ReadonlyArray<Found> => {
  const state = sidebarAgents.map((key) => sidebar.get(key)).find((value) => value !== undefined)
  const cwd = sidebar.get("focused_cwd") ?? sidebar.get("cwd")
  if (state === undefined || cwd === undefined) return []

  return [{ pane: `cmux:${workspace}`, cwd, working: state.startsWith("Running") }]
}

export const OrcaTerminals = Schema.Struct({
  result: Schema.Struct({
    terminals: Schema.Array(
      Schema.Struct({
        handle: Schema.String,
        worktreePath: Schema.String,
        connected: Schema.Boolean,
        writable: Schema.Boolean,
        agentIdentity: Schema.optionalKey(Schema.String)
      })
    )
  })
})

type OrcaTerminal = (typeof OrcaTerminals.Type)["result"]["terminals"][number]

const orcaRunsAgent = (terminal: OrcaTerminal): boolean => {
  if (terminal.agentIdentity === undefined) return false
  if (!terminal.connected) return false

  return terminal.writable
}

export const orcaAgents = (terminals: ReadonlyArray<OrcaTerminal>): ReadonlyArray<Found> =>
  terminals
    .filter(orcaRunsAgent)
    .map((terminal) => ({ pane: `orca:${terminal.handle}`, cwd: terminal.worktreePath, working: false }))

export const tmuxFormat = "#{pane_id}\t#{pane_current_path}\t#{pane_current_command}"

const agentCommands = new Set(["claude", "codex", "opencode", "gemini", "pi", "amp", "aider", "cursor-agent"])

const TmuxLine = Schema.Tuple([Schema.String, Schema.String, Schema.String])

const tmuxPane = (line: string): ReadonlyArray<Found> =>
  Option.match(Schema.decodeUnknownOption(TmuxLine)(line.split("\t")), {
    onNone: () => [],
    onSome: ([id, cwd, command]) => (agentCommands.has(command) ? [{ pane: `tmux:${id}`, cwd, working: false }] : [])
  })

export const tmuxAgents = (text: string): ReadonlyArray<Found> => text.split("\n").flatMap(tmuxPane)

export const ClaudeSession = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  status: Schema.optionalKey(Schema.String),
  messagingSocketPath: Schema.optionalKey(Schema.String)
})

export type ClaudeSession = typeof ClaudeSession.Type

export const claudeAgents = (
  sessions: ReadonlyArray<ClaudeSession>,
  terminals: ReadonlyArray<Found>
): ReadonlyArray<Found> =>
  sessions
    .filter((session) => session.messagingSocketPath !== undefined)
    .filter((session) => !terminals.some((terminal) => terminal.cwd === session.cwd))
    .map((session) => ({
      pane: `claude:${session.sessionId}`,
      cwd: session.cwd,
      working: session.status === "busy" || session.status === "working"
    }))

export const inboxLine = (text: string): string =>
  `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`

const pasteStart = "\u001b[200~"
const pasteEnd = "\u001b[201~"

export const bracketed = (text: string): string => `${pasteStart}${text}${pasteEnd}`
