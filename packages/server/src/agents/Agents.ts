import { SessionName } from "@review-desk/contract/Ids.ts"
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { createConnection } from "node:net"
import { DeskConfig } from "../config/DeskConfig.ts"
import { Shell } from "../platform/Shell.ts"
import { type Roster as Sightings, placeOf } from "../desk/Gone.ts"
import { parseAddress } from "./Address.ts"
import { ClaudeSession, claudeAgents, inboxLine } from "./Claude.ts"
import {
  type Failure,
  type Found,
  type Run,
  type Status,
  type Step,
  type TerminalHost,
  agentProgramsWith,
  decodeJson,
  lastLines
} from "./Host.ts"
import { enabledHosts, enabledTerminals, terminalHosts } from "./Hosts.ts"
import { herdrAgents, herdrFound } from "./hosts/Herdr.ts"
import { AppMachines, AppTerminals, appAgents, connectedMachines } from "./hosts/HerdrApp.ts"
import { type AgentTarget, type Location, locateScript, parseLocations } from "./Remote.ts"

export type LiveAgent = {
  readonly name: SessionName
  readonly machine: string | null
  readonly pane: string
  readonly cwd: string
  readonly status: Status
  readonly working: boolean
  readonly branch: Option.Option<string>
  readonly remote: Option.Option<string>
}

type Named = Found & { readonly name: string }

const shape = (found: Named, machine: string | null, where: Location): LiveAgent => ({
  name: SessionName.make(found.name),
  machine,
  pane: found.pane,
  cwd: found.cwd,
  status: found.status,
  working: found.status === "working",
  branch: where.branch,
  remote: where.remote
})

const named = (found: Found): Named => ({ ...found, name: found.name ?? found.pane })

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

const postToSocket = (socketPath: string, text: string) =>
  Effect.callback<void, Error>((resume) => {
    const connection = createConnection(socketPath)
    connection.once("error", (error) => resume(Effect.fail(error)))
    connection.once("connect", () => connection.end(inboxLine(text), () => resume(Effect.void)))

    return Effect.sync(() => connection.destroy())
  }).pipe(Effect.timeout(sendTimeout))

const failed = (target: AgentTarget) => (error: Failure) =>
  new PromptFailed({ agent: target.pane, reason: error.message })

type Heard = { readonly place: string; readonly agents: ReadonlyArray<LiveAgent> | null }

type Asked = { readonly host: TerminalHost; readonly found: Option.Option<ReadonlyArray<Found>> }

export type Roster = Omit<Sightings, "agents"> & { readonly agents: ReadonlyArray<LiveAgent> }

export class Agents extends Context.Service<
  Agents,
  {
    readonly list: Effect.Effect<ReadonlyArray<LiveAgent>, AgentsUnavailable>
    readonly roster: Effect.Effect<Roster, AgentsUnavailable>
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
      const sessionsDirectory = path.join(claudeHome, "sessions")
      const agentPrograms = agentProgramsWith(config.agentCommands)
      const askedHosts = enabledTerminals(config.hosts)
      const claudeOn = enabledHosts(config.hosts).includes("claude")

      const run: Run = (step: Step) =>
        shell.run(step.command, step.args, step.stdin === undefined ? {} : { stdin: step.stdin })

      const git = (cwd: string, args: ReadonlyArray<string>) =>
        shell.run("git", ["-C", cwd, ...args]).pipe(
          Effect.map((out) => out.trim()),
          Effect.option
        )

      const ask = (host: TerminalHost) =>
        host.list(run, agentPrograms).pipe(
          Effect.tapError((error) => Effect.logDebug(`${host.title} did not answer: ${error.message}`)),
          Effect.option,
          Effect.map((found): Asked => ({ host, found }))
        )

      const readSession = (file: string) =>
        fs.readFileString(path.join(sessionsDirectory, file)).pipe(decodeJson(ClaudeSession), Effect.option)

      const liveSocket = (session: ClaudeSession) =>
        session.messagingSocketPath === undefined
          ? Effect.succeed(false)
          : fs.exists(session.messagingSocketPath).pipe(Effect.orElseSucceed(() => false))

      const claudeSessions = fs.readDirectory(sessionsDirectory).pipe(
        Effect.flatMap((files) =>
          Effect.forEach(
            files.filter((file) => file.endsWith(".json")),
            readSession,
            { concurrency: 8 }
          )
        ),
        Effect.map((found) => found.flatMap(Option.toArray)),
        Effect.flatMap((sessions) => Effect.filter(sessions, liveSocket, { concurrency: 8 })),
        Effect.orElseSucceed((): ReadonlyArray<ClaudeSession> => [])
      )

      const sessionsHere = claudeOn ? claudeSessions : Effect.succeed<ReadonlyArray<ClaudeSession>>([])

      const locateHere = Effect.fnUntraced(function* (found: Named) {
        const [branch, remote] = yield* Effect.all(
          [git(found.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), git(found.cwd, ["remote", "get-url", "origin"])],
          { concurrency: 2 }
        )

        return shape(found, null, { branch, remote })
      })

      const here = Effect.gen(function* () {
        const [asked, sessions] = yield* Effect.all(
          [Effect.forEach(askedHosts, ask, { concurrency: 6 }), sessionsHere],
          { concurrency: 2 }
        )
        const inTerminals = asked.flatMap((one) => Option.getOrElse(one.found, () => [])).map(named)
        const all = [...inTerminals, ...claudeAgents(sessions, inTerminals).map(named)]
        const reached = asked.flatMap((one) => (Option.isSome(one.found) ? [placeOf(null, one.host.kind)] : []))
        const agents = yield* Effect.forEach(all, locateHere, { concurrency: 4 })

        return { agents, reached: claudeOn ? [...reached, placeOf(null, "claude")] : reached }
      })

      const nowhere: Location = { branch: Option.none(), remote: Option.none() }

      const there = Effect.fnUntraced(function* (machine: { readonly label: string; readonly seat: string }) {
        const agents = yield* herdrAgents(run, machine.label)
        const cwds = [...new Set(agents.map((agent) => agent.cwd))]
        const found = yield* shell.run("sth-seat", ["run", machine.seat, "-n", "--", locateScript(cwds)])
        const where = parseLocations(found)

        return agents.map((agent) => shape(herdrFound(agent), machine.label, where.get(agent.cwd) ?? nowhere))
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

        return found.map((agent) => shape(named(agent), machine, where.get(agent.cwd) ?? nowhere))
      })

      const appMachine = (machine: string) =>
        appThere(machine).pipe(
          Effect.tapError((error) => Effect.logWarning(`app agents on ${machine}: ${error.message}`)),
          Effect.map((agents): Heard => ({ place: placeOf(machine, "hc"), agents })),
          Effect.orElseSucceed((): Heard => ({ place: placeOf(machine, "hc"), agents: null }))
        )

      const appOn = enabledHosts(config.hosts).includes("hc")

      const appElsewhere = appOn
        ? shell.run("hc", ["machine", "ls"]).pipe(
            decodeJson(AppMachines),
            Effect.map(({ machines }) => connectedMachines(machines)),
            Effect.flatMap((machines) => Effect.forEach(machines, appMachine, { concurrency: 2 })),
            Effect.map((heard) => ({ listed: true, heard })),
            Effect.orElseSucceed(() => ({ listed: false, heard: [] }))
          )
        : Effect.succeed({ listed: true, heard: [] })

      const roster = Effect.all([here, elsewhere, appElsewhere], { concurrency: 3 }).pipe(
        Effect.map(([local, remote, inApps]): Roster => {
          const heard = [...remote, ...inApps.heard]

          return {
            agents: [...local.agents, ...heard.flatMap((one) => one.agents ?? [])],
            reached: [...local.reached, ...heard.flatMap((one) => (one.agents === null ? [] : [one.place]))],
            complete: inApps.listed && heard.every((one) => one.agents !== null)
          }
        }),
        Effect.withSpan("Agents.roster")
      )

      const list = Effect.map(roster, (found) => found.agents)

      const promptClaude = Effect.fnUntraced(function* (target: AgentTarget, id: string, text: string) {
        const sessions = yield* claudeSessions
        const socket = sessions.find((session) => session.sessionId === id)?.messagingSocketPath
        if (socket === undefined) return yield* failed(target)({ message: "the session has no inbox socket" })
        yield* postToSocket(socket, text).pipe(Effect.mapError(failed(target)))
      })

      const prompt = Effect.fn("Agents.prompt")(function* (target: AgentTarget, text: string) {
        yield* Effect.annotateCurrentSpan("agent", target.pane)
        const address = parseAddress(target.pane)
        if (address.host === "claude") return yield* promptClaude(target, address.id, text)
        const steps = terminalHosts[address.host].send(address.id, target.machine, text)
        yield* Effect.forEach(steps, (step) => run(step).pipe(Effect.mapError(failed(target))), { discard: true })
      })

      const read = Effect.fn("Agents.read")(function* (target: AgentTarget, lines: number) {
        const address = parseAddress(target.pane)
        const unreadable = (error: Failure) => new ReadFailed({ agent: target.pane, reason: error.message })
        if (address.host === "claude") return yield* unreadable({ message: "a Claude Code session has no screen" })
        const text = yield* run(terminalHosts[address.host].read(address.id, target.machine, lines)).pipe(
          Effect.mapError(unreadable)
        )

        return lastLines(text, lines)
      })

      return Agents.of({ list, roster, prompt, read })
    })
  )
}
