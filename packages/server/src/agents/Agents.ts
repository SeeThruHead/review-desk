import { SessionName } from "@review-desk/contract/Ids.ts"
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { createConnection } from "node:net"
import { DeskConfig } from "../config/DeskConfig.ts"
import { Shell } from "../platform/Shell.ts"
import { type Roster as Sightings, placeOf } from "../desk/Gone.ts"
import { parseAddress } from "./Address.ts"
import { type Directed, addressesIn, directed, unavailable } from "./Directory.ts"
import {
  type AgentHost,
  type Failure,
  type Files,
  type Found,
  type HostEnv,
  type Run,
  type Status,
  agentProgramsWith,
  decodeJson
} from "./Host.ts"
import { enabledHosts, prefixesOf, shippedHosts, yieldToTerminals } from "./Hosts.ts"
import { type PluginSpec, executableHost, pluginFile, usablePlugins } from "./hosts/Executable.ts"
import { herdrAgents, herdrFound } from "./hosts/Herdr.ts"
import { AppMachines, AppTerminals, appAgents, connectedMachines } from "./hosts/HerdrApp.ts"
import { reach, reachDirectory, reachFound } from "./hosts/Reach.ts"
import { type AgentTarget, type Location, locateScript, parseLocations } from "./Remote.ts"

export type LiveAgent = {
  readonly name: SessionName
  readonly machine: string | null
  readonly host: string
  readonly pane: string
  readonly cwd: string
  readonly status: Status
  readonly working: boolean
  readonly branch: Option.Option<string>
  readonly remote: Option.Option<string>
}

const shape = (found: Found, host: string, machine: string | null, where: Location): LiveAgent => ({
  name: SessionName.make(found.name ?? found.pane),
  machine,
  host,
  pane: found.pane,
  cwd: found.cwd,
  status: found.status,
  working: found.status === "working",
  branch: where.branch,
  remote: where.remote
})

export class AgentsUnavailable extends Schema.TaggedError<AgentsUnavailable, { readonly brand: unique symbol }>()(
  "AgentsUnavailable",
  { reason: Schema.String }
) {
  override get message() {
    return `no terminal host answered: ${this.reason}`
  }
}

export class PromptFailed extends Schema.TaggedError<PromptFailed, { readonly brand: unique symbol }>()(
  "PromptFailed",
  {
    agent: Schema.String,
    reason: Schema.String
  }
) {
  override get message() {
    return `could not hand the message to ${this.agent}: ${this.reason}`
  }
}

export class ReadFailed extends Schema.TaggedError<ReadFailed, { readonly brand: unique symbol }>()("ReadFailed", {
  agent: Schema.String,
  reason: Schema.String
}) {
  override get message() {
    return `could not read ${this.agent}'s terminal: ${this.reason}`
  }
}

const sendTimeout = "5 seconds"

const postLine = (socketPath: string, line: string) =>
  Effect.callback<void, Error>((resume) => {
    const connection = createConnection(socketPath)
    connection.once("error", (error) => resume(Effect.fail(error)))
    connection.once("connect", () => connection.end(line, () => resume(Effect.void)))

    return Effect.sync(() => connection.destroy())
  }).pipe(Effect.timeout(sendTimeout))

const failed = (target: AgentTarget) => (error: Failure) =>
  new PromptFailed({ agent: target.pane, reason: error.message })

const unreadable = (target: AgentTarget) => (error: Failure) =>
  new ReadFailed({ agent: target.pane, reason: error.message })

type Heard = { readonly place: string; readonly agents: ReadonlyArray<LiveAgent> | null }

type Asked = { readonly host: AgentHost; readonly found: Option.Option<ReadonlyArray<Found>> }

export type Roster = Omit<Sightings, "agents"> & { readonly agents: ReadonlyArray<LiveAgent> }

export class Agents extends Context.Service<
  Agents,
  {
    readonly list: Effect.Effect<ReadonlyArray<LiveAgent>, AgentsUnavailable>
    readonly roster: (wanted: Iterable<string>) => Effect.Effect<Roster, AgentsUnavailable>
    readonly prompt: (target: AgentTarget, text: string) => Effect.Effect<void, PromptFailed>
    readonly read: (target: AgentTarget, lines: number) => Effect.Effect<string, ReadFailed>
  }
>()("review-desk/server/Agents") {
  static readonly layer = Layer.effect(
    Agents,
    Effect.gen(function* () {
      const shell = yield* Shell
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const config = yield* DeskConfig
      const home = yield* Config.String("HOME").pipe(Config.withDefault("."))
      const claudeHome = yield* Config.String("CLAUDE_CONFIG_DIR").pipe(Config.withDefault(path.join(home, ".claude")))

      const run: Run = (step) =>
        shell.run(step.command, step.args, {
          ...(step.stdin === undefined ? {} : { stdin: step.stdin }),
          ...(step.env === undefined ? {} : { env: step.env })
        })

      const files: Files = {
        readText: (file) => fs.readFileString(file),
        list: (directory) => fs.readDirectory(directory),
        exists: (file) => fs.exists(file).pipe(Effect.orElseSucceed(() => false))
      }

      const env: HostEnv = { run, files, postLine, agentPrograms: agentProgramsWith(config.agentCommands) }

      const pluginsDirectory = path.join(config.home, "plugins")
      const dropped = yield* files.list(pluginsDirectory).pipe(
        Effect.map((names) => names.toSorted().flatMap((name) => pluginFile(pluginsDirectory, name))),
        Effect.orElseSucceed((): ReadonlyArray<PluginSpec> => [])
      )
      const plugins = usablePlugins([...(config.plugins ?? []), ...dropped])
      yield* Effect.forEach(plugins.refused, (one) =>
        Effect.logWarning(`left out the ${one.name} plugin: ${one.reason}`)
      )
      yield* Effect.forEach(plugins.usable, (one) => Effect.logInfo(`loaded the ${one.name} host plugin`))

      const listingHosts = [...shippedHosts(path.join(claudeHome, "sessions")), ...plugins.usable.map(executableHost)]
      const everyHost = [...listingHosts, reach]
      const askedHosts = enabledHosts(listingHosts, config.hosts)
      const prefixes = prefixesOf(everyHost)
      const hostOf = (pane: string) => parseAddress(pane, prefixes).host

      const git = (cwd: string, args: ReadonlyArray<string>) =>
        shell.run("git", ["-C", cwd, ...args]).pipe(
          Effect.map((out) => out.trim()),
          Effect.option
        )

      const ask = (host: AgentHost) =>
        host.list(env).pipe(
          Effect.tapError((error) => Effect.logDebug(`${host.title} did not answer: ${error.message}`)),
          Effect.option,
          Effect.map((found): Asked => ({ host, found }))
        )

      const locateHere = Effect.fnUntraced(function* (found: Found) {
        const [branch, remote] = yield* Effect.all(
          [git(found.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), git(found.cwd, ["remote", "get-url", "origin"])],
          { concurrency: 2 }
        )

        return shape(found, hostOf(found.pane), null, { branch, remote })
      })

      const here = Effect.gen(function* () {
        const asked = yield* Effect.forEach(askedHosts, ask, { concurrency: 6 })
        const answered = asked.flatMap((one) =>
          Option.isSome(one.found) ? [{ host: one.host, agents: one.found.value }] : []
        )
        const agents = yield* Effect.forEach(yieldToTerminals(answered), locateHere, { concurrency: 4 })

        return { agents, reached: answered.map((one) => placeOf(null, one.host.name)) }
      })

      const nowhere: Location = { branch: Option.none(), remote: Option.none() }

      const there = Effect.fnUntraced(function* (machine: { readonly label: string; readonly seat: string }) {
        const agents = yield* herdrAgents(run, machine.label)
        const cwds = [...new Set(agents.map((agent) => agent.cwd))]
        const found = yield* shell.run("sth-seat", ["run", machine.seat, "-n", "--", locateScript(cwds)])
        const where = parseLocations(found)

        return agents.map((agent) => shape(herdrFound(agent), "herdr", machine.label, where.get(agent.cwd) ?? nowhere))
      })

      const elsewhere = Effect.forEach(
        config.machines ?? [],
        (machine) =>
          there(machine).pipe(
            Effect.tapError((error) => Effect.logWarning(`agents on ${machine.label}: ${error.message}`)),
            Effect.map((agents): Heard => ({ place: placeOf(machine.label, "herdr"), agents })),
            Effect.orElseSucceed((): Heard => ({ place: placeOf(machine.label, "herdr"), agents: null }))
          ),
        { concurrency: 2 }
      )

      const locateOn = (machine: string, cwds: ReadonlyArray<string>) =>
        cwds.length === 0
          ? Effect.succeed("")
          : shell.run("hc", ["exec", "--on", machine, "sh", "-c", locateScript(cwds)])

      const appThere = Effect.fnUntraced(function* (machine: string) {
        const { terminals: listed } = yield* shell
          .run("hc", ["exec", "--on", machine, "hc", "ls", "--json"])
          .pipe(decodeJson(AppTerminals))
        const found = appAgents(listed, machine)
        const located = yield* locateOn(machine, [...new Set(found.map((agent) => agent.cwd))])
        const where = parseLocations(located)

        return found.map((agent) => shape(agent, "hc", machine, where.get(agent.cwd) ?? nowhere))
      })

      const appMachine = (machine: string) =>
        appThere(machine).pipe(
          Effect.tapError((error) => Effect.logWarning(`app agents on ${machine}: ${error.message}`)),
          Effect.map((agents): Heard => ({ place: placeOf(machine, "hc"), agents })),
          Effect.orElseSucceed((): Heard => ({ place: placeOf(machine, "hc"), agents: null }))
        )

      const appElsewhere = askedHosts.some((host) => host.name === "hc")
        ? shell.run("hc", ["machine", "ls"]).pipe(
            decodeJson(AppMachines),
            Effect.map(({ machines }) => connectedMachines(machines)),
            Effect.flatMap((machines) => Effect.forEach(machines, appMachine, { concurrency: 2 })),
            Effect.map((heard) => ({ listed: true, heard })),
            Effect.orElseSucceed(() => ({ listed: false, heard: [] }))
          )
        : Effect.succeed({ listed: true, heard: [] })

      const addressed = (wanted: Iterable<string>) => {
        const addresses = addressesIn(wanted)
        if (addresses.length === 0) return Effect.succeed<Directed>(directed([], []))

        return reachDirectory(run).pipe(
          Effect.map(({ agents }) => directed(addresses, agents)),
          Effect.tapError((error) => Effect.logWarning(`reach did not answer: ${error.message}`)),
          Effect.orElseSucceed(() => unavailable(addresses, "reach is not installed or did not answer"))
        )
      }

      const roster = (wanted: Iterable<string>) =>
        Effect.all([here, elsewhere, appElsewhere, addressed(wanted)], { concurrency: 4 }).pipe(
          Effect.map(([local, remote, inApps, byAddress]): Roster => {
            const heard = [...remote, ...inApps.heard]

            return {
              agents: [
                ...local.agents,
                ...heard.flatMap((one) => one.agents ?? []),
                ...byAddress.found.map((agent) => shape(reachFound(agent), "reach", null, nowhere))
              ],
              reached: [...local.reached, ...heard.flatMap((one) => (one.agents === null ? [] : [one.place]))],
              complete: inApps.listed && heard.every((one) => one.agents !== null),
              prefixes,
              refused: byAddress.refused
            }
          }),
          Effect.withSpan("Agents.roster")
        )

      const list = Effect.map(roster([]), (found) => found.agents)

      const hostFor = (target: AgentTarget) => {
        const address = parseAddress(target.pane, prefixes)
        const host = everyHost.find((one) => one.name === address.host)

        return host === undefined
          ? Effect.fail({ message: `no host is named ${address.host}` })
          : Effect.succeed({ host, target: { id: address.id, machine: target.machine } })
      }

      const prompt = Effect.fn("Agents.prompt")(function* (target: AgentTarget, text: string) {
        yield* Effect.annotateCurrentSpan("agent", target.pane)
        const found = yield* hostFor(target).pipe(Effect.mapError(failed(target)))
        yield* found.host.send(env, found.target, text).pipe(Effect.mapError(failed(target)))
      })

      const read = Effect.fn("Agents.read")(function* (target: AgentTarget, lines: number) {
        const found = yield* hostFor(target).pipe(Effect.mapError(unreadable(target)))

        return yield* found.host.read(env, found.target, lines).pipe(Effect.mapError(unreadable(target)))
      })

      return Agents.of({ list, roster, prompt, read })
    })
  )
}
