import { Effect, Option, Schema } from "effect"
import { type Found, type Run, type Status, type TerminalHost, bracketed, decodeJson } from "../Host.ts"

export const RexSessions = Schema.Struct({ sessions: Schema.Array(Schema.Struct({ session_id: Schema.String })) })

export const RexBlocks = Schema.Struct({
  blocks: Schema.Array(
    Schema.Struct({
      block_id: Schema.String,
      flavor: Schema.String,
      label: Schema.optionalKey(Schema.NullOr(Schema.String))
    })
  )
})

const RexProgram = Schema.Struct({ argv0: Schema.optionalKey(Schema.String), cwd: Schema.optionalKey(Schema.String) })

export const RexProcess = Schema.Struct({
  foreground: Schema.optionalKey(Schema.NullOr(RexProgram)),
  child: Schema.optionalKey(Schema.NullOr(RexProgram)),
  last_exit: Schema.optionalKey(Schema.Unknown)
})

export const RexStatus = Schema.Struct({
  records: Schema.optionalKey(
    Schema.Array(Schema.Struct({ state: Schema.String, id: Schema.optionalKey(Schema.NullOr(Schema.String)) }))
  )
})

type Block = (typeof RexBlocks.Type)["blocks"][number]

export type RexBlock = { readonly session: string; readonly block: string; readonly label: string | null }

export const terminalBlocks = (session: string, blocks: ReadonlyArray<Block>): ReadonlyArray<RexBlock> =>
  blocks
    .filter((block) => block.flavor.includes("terminal"))
    .map((block) => ({ session, block: block.block_id, label: block.label ?? null }))

const programName = (argv0: string): string => argv0.slice(argv0.lastIndexOf("/") + 1)

const agentProgram = (process: typeof RexProcess.Type, agentPrograms: ReadonlySet<string>) =>
  [process.foreground, process.child].find(
    (program) => program?.argv0 !== undefined && agentPrograms.has(programName(program.argv0))
  )

export const rexAgent = (
  where: RexBlock,
  process: typeof RexProcess.Type,
  status: Status,
  agentPrograms: ReadonlySet<string>
): ReadonlyArray<Found> => {
  const program = agentProgram(process, agentPrograms)
  if (program?.cwd === undefined) return []

  return [
    {
      pane: `rex:${where.session}/${where.block}`,
      cwd: program.cwd,
      status,
      ...(where.label ? { name: where.label } : {})
    }
  ]
}

export const rexStatus = (reported: typeof RexStatus.Type): Status => {
  const root = (reported.records ?? []).filter((record) => !record.id).at(-1)
  if (root === undefined) return "unknown"
  if (root.state === "working") return "working"
  if (root.state === "blocked") return "blocked"

  return "idle"
}

export type RexTarget = { readonly session: string; readonly block: string }

export const rexTarget = (id: string): RexTarget => {
  const slash = id.indexOf("/")

  return slash < 0 ? { session: "", block: id } : { session: id.slice(0, slash), block: id.slice(slash + 1) }
}

const targetArgs = (id: string): ReadonlyArray<string> => {
  const { session, block } = rexTarget(id)

  return session === "" ? ["-b", block] : ["-s", session, "-b", block]
}

const call = (run: Run, where: RexBlock, method: string) =>
  run({ command: "rex", args: ["block", "call", "-s", where.session, "-b", where.block, method] })

const blockAgent = (run: Run, where: RexBlock, agentPrograms: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const process = yield* call(run, where, "process").pipe(decodeJson(RexProcess))
    if (agentProgram(process, agentPrograms) === undefined) return []
    const status = yield* call(run, where, "program_status").pipe(
      decodeJson(RexStatus),
      Effect.map(rexStatus),
      Effect.orElseSucceed((): Status => "unknown")
    )

    return rexAgent(where, process, status, agentPrograms)
  }).pipe(
    Effect.tapError((error) => Effect.logDebug(`Rex block ${where.block} could not be read: ${error.message}`)),
    Effect.option,
    Effect.map((found) => Option.getOrElse(found, () => []))
  )

const sessionBlocks = (run: Run, session: string) =>
  run({ command: "rex", args: ["block", "ls", "-s", session, "--json"] }).pipe(
    decodeJson(RexBlocks),
    Effect.map(({ blocks }) => terminalBlocks(session, blocks))
  )

export const rex: TerminalHost = {
  kind: "rex",
  title: "Rex",
  list: (run, agentPrograms) =>
    run({ command: "rex", args: ["--autostart=false", "ls", "--json"] }).pipe(
      decodeJson(RexSessions),
      Effect.flatMap(({ sessions }) =>
        Effect.forEach(sessions, (session) => sessionBlocks(run, session.session_id), { concurrency: 2 })
      ),
      Effect.flatMap((blocks) =>
        Effect.forEach(blocks.flat(), (where) => blockAgent(run, where, agentPrograms), { concurrency: 4 })
      ),
      Effect.map((found) => found.flat())
    ),
  send: (id, _machine, text) => [
    { command: "rex", args: ["send", ...targetArgs(id)], stdin: bracketed(text) },
    { command: "rex", args: ["send-key", ...targetArgs(id), "enter"] }
  ],
  read: (id) => ({ command: "rex", args: ["capture", ...targetArgs(id), "--trim", "--unwrap"] })
}
