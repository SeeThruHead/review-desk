import { SessionName } from "@review-desk/contract/Ids.ts"
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect"
import { createConnection } from "node:net"
import { DeskConfig } from "../config/DeskConfig.ts"
import { type CommandFailed, Shell } from "../platform/Shell.ts"
import { type Step, deliveryFor } from "./Delivery.ts"
import { type AgentTarget, type Location, locateScript, parseLocations } from "./Remote.ts"
import {
  AppMachines,
  AppTerminals,
  ClaudeSession,
  CmuxWorkspaces,
  type Found,
  OrcaTerminals,
  appAgents,
  connectedMachines,
  claudeAgents,
  cmuxAgent,
  inboxLine,
  orcaAgents,
  sidebarFields,
  tmuxAgents,
  tmuxFormat
} from "./Terminals.ts"

const HerdrAgent = Schema.Struct({
  agent: Schema.String,
  agent_status: Schema.String,
  cwd: Schema.String,
  pane_id: Schema.String,
  name: Schema.optionalKey(Schema.NullOr(Schema.String))
})

const AgentList = Schema.Struct({ result: Schema.Struct({ agents: Schema.Array(HerdrAgent) }) })

export type LiveAgent = {
  readonly name: SessionName
  readonly machine: string | null
  readonly pane: string
  readonly cwd: string
  readonly working: boolean
  readonly branch: Option.Option<string>
  readonly remote: Option.Option<string>
}

type Named = Found & { readonly name: string }

const herdrFound = (agent: typeof HerdrAgent.Type): Named => ({
  name: agent.name ?? agent.pane_id,
  pane: agent.pane_id,
  cwd: agent.cwd,
  working: agent.agent_status === "working"
})

const shape = (found: Named, machine: string | null, where: Location): LiveAgent => ({
  name: SessionName.make(found.name),
  machine,
  pane: found.pane,
  cwd: found.cwd,
  working: found.working,
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

const decodeJson = <S extends Schema.Top>(schema: S) =>
  Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(schema)))

const quiet =
  (host: string) =>
  <E extends { readonly message: string }>(found: Effect.Effect<ReadonlyArray<Found>, E>) =>
    found.pipe(
      Effect.tapError((error) => Effect.logDebug(`${host} did not answer: ${error.message}`)),
      Effect.orElseSucceed((): ReadonlyArray<Found> => [])
    )

const failed = (target: AgentTarget) => (error: { readonly message: string }) =>
  new PromptFailed({ agent: target.pane, reason: error.message })

const sendTimeout = "5 seconds"

const postToSocket = (socketPath: string, text: string) =>
  Effect.callback<void, Error>((resume) => {
    const connection = createConnection(socketPath)
    connection.once("error", (error) => resume(Effect.fail(error)))
    connection.once("connect", () => connection.end(inboxLine(text), () => resume(Effect.void)))

    return Effect.sync(() => connection.destroy())
  }).pipe(Effect.timeout(sendTimeout))

export class Agents extends Context.Service<
  Agents,
  {
    readonly list: Effect.Effect<ReadonlyArray<LiveAgent>, AgentsUnavailable>
    readonly prompt: (target: AgentTarget, text: string) => Effect.Effect<void, PromptFailed>
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

      const git = (cwd: string, args: ReadonlyArray<string>) =>
        shell.run("git", ["-C", cwd, ...args]).pipe(
          Effect.map((out) => out.trim()),
          Effect.option
        )

      const herdrHere = shell.run("herdr", ["agent", "list"]).pipe(
        decodeJson(AgentList),
        Effect.map(({ result }) => result.agents.map(herdrFound)),
        Effect.tapError((error) => Effect.logDebug(`herdr did not answer: ${error.message}`)),
        Effect.orElseSucceed((): ReadonlyArray<Named> => [])
      )

      const app = shell.run("hc", ["ls", "--json"]).pipe(
        decodeJson(AppTerminals),
        Effect.map(({ terminals }) => appAgents(terminals)),
        quiet("the Herdr app")
      )

      const cmuxWorkspace = (id: string) =>
        shell
          .run("cmux", ["sidebar-state", "--workspace", id])
          .pipe(Effect.map((text) => cmuxAgent(id, sidebarFields(text))))

      const cmux = shell.run("cmux", ["--json", "--id-format", "uuids", "list-workspaces"]).pipe(
        decodeJson(CmuxWorkspaces),
        Effect.flatMap(({ workspaces }) =>
          Effect.forEach(workspaces, (workspace) => cmuxWorkspace(workspace.id), { concurrency: 4 })
        ),
        Effect.map((found) => found.flat()),
        quiet("cmux")
      )

      const orca = shell.run("orca", ["terminal", "list", "--json"]).pipe(
        decodeJson(OrcaTerminals),
        Effect.map(({ result }) => orcaAgents(result.terminals)),
        quiet("orca")
      )

      const tmux = shell.run("tmux", ["list-panes", "-a", "-F", tmuxFormat]).pipe(Effect.map(tmuxAgents), quiet("tmux"))

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

      const locateHere = Effect.fnUntraced(function* (found: Named) {
        const [branch, remote] = yield* Effect.all(
          [git(found.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), git(found.cwd, ["remote", "get-url", "origin"])],
          { concurrency: 2 }
        )

        return shape(found, null, { branch, remote })
      })

      const here = Effect.gen(function* () {
        const [herdr, inApp, inCmux, inOrca, inTmux, sessions] = yield* Effect.all(
          [herdrHere, app, cmux, orca, tmux, claudeSessions],
          { concurrency: 6 }
        )
        const terminals: ReadonlyArray<Named> = [...herdr, ...[...inApp, ...inCmux, ...inOrca, ...inTmux].map(named)]
        const all = [...terminals, ...claudeAgents(sessions, terminals).map(named)]

        return yield* Effect.forEach(all, locateHere, { concurrency: 4 })
      })

      const nowhere: Location = { branch: Option.none(), remote: Option.none() }

      const there = Effect.fnUntraced(function* (machine: { readonly label: string; readonly seat: string }) {
        const { result } = yield* shell
          .run("herdr", ["--machine", machine.label, "agent", "list"])
          .pipe(decodeJson(AgentList))
        const cwds = [...new Set(result.agents.map((agent) => agent.cwd))]
        const found = yield* shell.run("sth-seat", ["run", machine.seat, "-n", "--", locateScript(cwds)])
        const where = parseLocations(found)

        return result.agents.map((agent) => shape(herdrFound(agent), machine.label, where.get(agent.cwd) ?? nowhere))
      })

      const elsewhere = Effect.forEach(
        config.machines ?? [],
        (machine) =>
          there(machine).pipe(
            Effect.tapError((error) => Effect.logWarning(`agents on ${machine.label}: ${error.message}`)),
            Effect.orElseSucceed((): ReadonlyArray<LiveAgent> => [])
          ),
        { concurrency: 2 }
      )

      const locateOn = (machine: string, cwds: ReadonlyArray<string>) =>
        cwds.length === 0
          ? Effect.succeed("")
          : shell.run("hc", ["exec", "--on", machine, "sh", "-c", locateScript(cwds)])

      const appThere = Effect.fnUntraced(function* (machine: string) {
        const { terminals } = yield* shell
          .run("hc", ["exec", "--on", machine, "hc", "ls", "--json"])
          .pipe(decodeJson(AppTerminals))
        const found = appAgents(terminals, machine)
        const located = yield* locateOn(machine, [...new Set(found.map((agent) => agent.cwd))])
        const where = parseLocations(located)

        return found.map((agent) => shape(named(agent), machine, where.get(agent.cwd) ?? nowhere))
      })

      const appElsewhere = shell.run("hc", ["machine", "ls"]).pipe(
        decodeJson(AppMachines),
        Effect.map(({ machines }) => connectedMachines(machines)),
        Effect.orElseSucceed((): ReadonlyArray<string> => []),
        Effect.flatMap((machines) =>
          Effect.forEach(
            machines,
            (machine) =>
              appThere(machine).pipe(
                Effect.tapError((error) => Effect.logWarning(`app agents on ${machine}: ${error.message}`)),
                Effect.orElseSucceed((): ReadonlyArray<LiveAgent> => [])
              ),
            { concurrency: 2 }
          )
        )
      )

      const list = Effect.all([here, elsewhere, appElsewhere], { concurrency: 3 }).pipe(
        Effect.map(([local, remote, remoteApp]) => [...local, ...remote.flat(), ...remoteApp.flat()]),
        Effect.withSpan("Agents.list")
      )

      const run = (target: AgentTarget, step: Step) =>
        shell.run(step.command, step.args, step.stdin === undefined ? {} : { stdin: step.stdin }).pipe(
          Effect.asVoid,
          Effect.mapError((error: CommandFailed) => failed(target)(error))
        )

      const promptClaude = Effect.fnUntraced(function* (target: AgentTarget, id: string, text: string) {
        const sessions = yield* claudeSessions
        const socket = sessions.find((session) => session.sessionId === id)?.messagingSocketPath
        if (socket === undefined) return yield* failed(target)({ message: "the session has no inbox socket" })
        yield* postToSocket(socket, text).pipe(Effect.mapError(failed(target)))
      })

      const prompt = Effect.fn("Agents.prompt")(function* (target: AgentTarget, text: string) {
        yield* Effect.annotateCurrentSpan("agent", target.pane)
        const delivery = deliveryFor(target, text)
        if (delivery._tag === "Inbox") return yield* promptClaude(target, delivery.session, text)
        yield* Effect.forEach(delivery.steps, (step) => run(target, step), { discard: true })
      })

      return Agents.of({ list, prompt })
    })
  )
}
