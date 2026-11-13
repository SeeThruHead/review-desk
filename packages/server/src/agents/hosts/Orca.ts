import { Effect, Schema } from "effect"
import { type Found, type TerminalHost, decodeJson } from "../Host.ts"

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

const runsAgent = (terminal: OrcaTerminal): boolean => {
  if (terminal.agentIdentity === undefined) return false
  if (!terminal.connected) return false

  return terminal.writable
}

export const orcaAgents = (terminals: ReadonlyArray<OrcaTerminal>): ReadonlyArray<Found> =>
  terminals
    .filter(runsAgent)
    .map((terminal) => ({ pane: `orca:${terminal.handle}`, cwd: terminal.worktreePath, status: "unknown" }))

export const orca: TerminalHost = {
  kind: "orca",
  title: "Orca",
  list: (run) =>
    run({ command: "orca", args: ["terminal", "list", "--json"] }).pipe(
      decodeJson(OrcaTerminals),
      Effect.map(({ result }) => orcaAgents(result.terminals))
    ),
  send: (id, _machine, text) => [
    { command: "orca", args: ["terminal", "send", "--terminal", id, "--text", text, "--enter"] }
  ],
  read: (id) => ({ command: "orca", args: ["terminal", "read", "--terminal", id, "--screen"] })
}
