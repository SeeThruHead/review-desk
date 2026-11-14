import { Effect, Schema } from "effect"
import { type Found, commandHost, decodeJson, statusOf } from "../Host.ts"

export const AppTerminal = Schema.Struct({
  address: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String)),
  agent: Schema.optionalKey(Schema.NullOr(Schema.String)),
  cwd: Schema.optionalKey(Schema.NullOr(Schema.String)),
  state: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.NullOr(Schema.String))
})

export const AppTerminals = Schema.Struct({ terminals: Schema.Array(AppTerminal) })

export const AppMachines = Schema.Struct({
  machines: Schema.Array(Schema.Struct({ name: Schema.String, state: Schema.String }))
})

export const connectedMachines = (machines: (typeof AppMachines.Type)["machines"]): ReadonlyArray<string> =>
  machines.filter((machine) => machine.state === "connected").map((machine) => machine.name)

const appAgent =
  (machine: string | null) =>
  (terminal: typeof AppTerminal.Type): ReadonlyArray<Found> => {
    if (!terminal.agent) return []
    const status = terminal.agent.endsWith("-asleep") ? "idle" : terminal.status
    if (!status) return []
    if (terminal.state !== "live") return []
    if (!terminal.cwd) return []
    if (terminal.address.includes("/")) return []
    const address = machine === null ? terminal.address : `${machine}/${terminal.address}`

    return [
      {
        pane: `hc:${address}`,
        cwd: terminal.cwd,
        status: statusOf(status),
        ...(terminal.name ? { name: terminal.name } : {})
      }
    ]
  }

export const appAgents = (
  terminals: ReadonlyArray<typeof AppTerminal.Type>,
  machine: string | null = null
): ReadonlyArray<Found> => terminals.flatMap(appAgent(machine))

export const herdrApp = commandHost({
  name: "hc",
  title: "the Herdr app",
  list: ({ run }) =>
    run({ command: "hc", args: ["ls", "--json"] }).pipe(
      decodeJson(AppTerminals),
      Effect.map(({ terminals }) => appAgents(terminals))
    ),
  steps: ({ id }, text) => [{ command: "hc", args: ["send", id, text] }],
  screen: ({ id }, lines) => ({ command: "hc", args: ["read", id, "--lines", String(lines)] })
})
