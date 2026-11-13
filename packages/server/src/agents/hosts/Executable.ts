import { Effect, Schema } from "effect"
import { shippedHostNames } from "../Address.ts"
import { type Found, type HostEnv, commandHost, decodeJson } from "../Host.ts"

export const PluginAgents = Schema.Struct({
  agents: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      cwd: Schema.String,
      status: Schema.optionalKey(Schema.Literals(["idle", "working", "blocked", "unknown"])),
      name: Schema.optionalKey(Schema.String)
    })
  )
})

export type PluginSpec = { readonly name: string; readonly command: readonly [string, ...Array<string>] }

export type Refused = { readonly name: string; readonly reason: string }

const validName = /^[a-z][a-z0-9-]{0,31}$/

const problemOf = (spec: PluginSpec, earlier: ReadonlyArray<PluginSpec>): string | null => {
  if (!validName.test(spec.name)) return "a plugin name is lowercase letters, digits and dashes, starting with a letter"
  if (shippedHostNames.some((name) => name === spec.name)) return "a shipped host already has that name"
  if (earlier.some((other) => other.name === spec.name)) return "another plugin already has that name"

  return null
}

export const usablePlugins = (
  specs: ReadonlyArray<PluginSpec>
): { readonly usable: ReadonlyArray<PluginSpec>; readonly refused: ReadonlyArray<Refused> } => {
  const judged = specs.map((spec, index) => ({ spec, problem: problemOf(spec, specs.slice(0, index)) }))

  return {
    usable: judged.filter((one) => one.problem === null).map((one) => one.spec),
    refused: judged.flatMap((one) => (one.problem === null ? [] : [{ name: one.spec.name, reason: one.problem }]))
  }
}

export const pluginFile = (directory: string, file: string): ReadonlyArray<PluginSpec> => {
  if (file.startsWith(".")) return []
  const name = file.replace(/\.[^.]*$/, "")

  return [{ name, command: [`${directory}/${file}`] }]
}

const programsOf = (env: HostEnv) => ({ REVIEW_DESK_AGENT_PROGRAMS: [...env.agentPrograms].join(",") })

export const executableHost = (spec: PluginSpec) => {
  const [program, ...fixed] = spec.command

  return commandHost({
    name: spec.name,
    title: `the ${spec.name} plugin`,
    list: (env) =>
      env.run({ command: program, args: [...fixed, "list"], env: programsOf(env) }).pipe(
        decodeJson(PluginAgents),
        Effect.map(({ agents }) =>
          agents.map((agent): Found => ({
            pane: `${spec.name}:${agent.id}`,
            cwd: agent.cwd,
            status: agent.status ?? "unknown",
            ...(agent.name === undefined ? {} : { name: agent.name })
          }))
        )
      ),
    steps: ({ id }, text) => [{ command: program, args: [...fixed, "send", id], stdin: text }],
    screen: ({ id }, lines) => ({ command: program, args: [...fixed, "read", id, String(lines)] })
  })
}
