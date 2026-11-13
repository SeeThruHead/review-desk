import { Effect, Schema } from "effect"
import { type Found, type Run, commandHost, decodeJson, statusOf } from "../Host.ts"

export const HerdrAgent = Schema.Struct({
  agent: Schema.String,
  agent_status: Schema.String,
  cwd: Schema.String,
  pane_id: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

export const AgentList = Schema.Struct({ result: Schema.Struct({ agents: Schema.Array(HerdrAgent) }) })

export const herdrFound = (agent: typeof HerdrAgent.Type): Found & { readonly name: string } => ({
  name: agent.name ?? agent.pane_id,
  pane: agent.pane_id,
  cwd: agent.cwd,
  status: statusOf(agent.agent_status)
})

const on = (machine: string | null): ReadonlyArray<string> => (machine === null ? [] : ["--machine", machine])

export const herdrAgents = (run: Run, machine: string | null) =>
  run({ command: "herdr", args: [...on(machine), "agent", "list"] }).pipe(
    decodeJson(AgentList),
    Effect.map(({ result }) => result.agents)
  )

export const herdr = commandHost({
  name: "herdr",
  title: "the Herdr TUI",
  list: ({ run }) => herdrAgents(run, null).pipe(Effect.map((agents) => agents.map(herdrFound))),
  steps: ({ id, machine }, text) => [{ command: "herdr", args: [...on(machine), "agent", "prompt", id, text] }],
  screen: ({ id, machine }, lines) => ({
    command: "herdr",
    args: [...on(machine), "agent", "read", id, "--lines", String(lines)]
  })
})
