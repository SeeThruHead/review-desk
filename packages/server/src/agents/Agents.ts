import { SessionName } from "@review-desk/contract/Ids.ts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { DeskConfig } from "../config/DeskConfig.ts"
import { Shell } from "../platform/Shell.ts"
import { type AgentTarget, type Location, locateScript, parseLocations } from "./Remote.ts"

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

const shape = (agent: typeof HerdrAgent.Type, machine: string | null, where: Location): LiveAgent => ({
  name: SessionName.make(agent.name ?? agent.pane_id),
  machine,
  pane: agent.pane_id,
  cwd: agent.cwd,
  working: agent.agent_status === "working",
  branch: where.branch,
  remote: where.remote
})

export class AgentsUnavailable extends Schema.TaggedError<AgentsUnavailable, { readonly brand: unique symbol }>()(
  "AgentsUnavailable",
  { reason: Schema.String }
) {
  override get message() {
    return `Herdr did not answer: ${this.reason}`
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

      const config = yield* DeskConfig

      const git = (cwd: string, args: ReadonlyArray<string>) =>
        shell.run("git", ["-C", cwd, ...args]).pipe(
          Effect.map((out) => out.trim()),
          Effect.option
        )

      const decodeList = Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(AgentList)))

      const locateHere = Effect.fnUntraced(function* (agent: typeof HerdrAgent.Type) {
        const [branch, remote] = yield* Effect.all(
          [git(agent.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]), git(agent.cwd, ["remote", "get-url", "origin"])],
          { concurrency: 2 }
        )

        return shape(agent, null, { branch, remote })
      })

      const here = shell.run("herdr", ["agent", "list"]).pipe(
        decodeList,
        Effect.flatMap(({ result }) => Effect.forEach(result.agents, locateHere, { concurrency: 4 }))
      )

      const nowhere: Location = { branch: Option.none(), remote: Option.none() }

      const there = Effect.fnUntraced(function* (machine: { readonly label: string; readonly seat: string }) {
        const { result } = yield* shell.run("herdr", ["--machine", machine.label, "agent", "list"]).pipe(decodeList)
        const cwds = [...new Set(result.agents.map((agent) => agent.cwd))]
        const found = yield* shell.run("sth-seat", ["run", machine.seat, "-n", "--", locateScript(cwds)])
        const where = parseLocations(found)

        return result.agents.map((agent) => shape(agent, machine.label, where.get(agent.cwd) ?? nowhere))
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

      const list = Effect.all([here, elsewhere], { concurrency: 2 }).pipe(
        Effect.mapBoth({
          onSuccess: ([local, remote]) => [...local, ...remote.flat()],
          onFailure: (error) => new AgentsUnavailable({ reason: error.message })
        }),
        Effect.withSpan("Agents.list")
      )

      const prompt = Effect.fn("Agents.prompt")(function* (target: AgentTarget, text: string) {
        yield* Effect.annotateCurrentSpan("agent", target.pane)
        const machine = target.machine === null ? [] : ["--machine", target.machine]
        yield* shell
          .run("herdr", [...machine, "agent", "prompt", target.pane, text])
          .pipe(Effect.mapError((error) => new PromptFailed({ agent: target.pane, reason: error.message })))
      })

      return Agents.of({ list, prompt })
    })
  )
}
