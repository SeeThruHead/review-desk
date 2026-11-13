import { BunRuntime, BunServices } from "@effect/platform-bun"
import { type AgentRow, CommentOutcome, DeskRpcs, Summary } from "@review-desk/contract/Contract.ts"
import { Role, Verdict } from "@review-desk/contract/Board.ts"
import { Login, PrKey, RepoSlug, SessionName, Text } from "@review-desk/contract/Ids.ts"
import { Cause, Config, Console, Effect, FileSystem, Layer, Option, Path, Schema, Stream } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { FetchHttpClient } from "effect/http"
import { RpcClient, RpcSerialization } from "effect/rpc"
import { callerAddress } from "./agents/Address.ts"
import { Agents } from "./agents/Agents.ts"
import { ClaudeSession } from "./agents/hosts/Claude.ts"
import { DeskConfig } from "./config/DeskConfig.ts"
import { Desk } from "./desk/Desk.ts"
import { ForgesLive } from "./forge/Forges.ts"
import { HttpLive } from "./http/Server.ts"
import { Shell } from "./platform/Shell.ts"
import { Database } from "./store/Database.ts"
import { DeskRepo } from "./store/DeskRepo.ts"

const DeskLive = Desk.layer.pipe(
  Layer.provide([ForgesLive, Agents.layer, DeskRepo.layer]),
  Layer.provide(Database),
  Layer.provide([Shell.layer, FetchHttpClient.layer]),
  Layer.provide(DeskConfig.layer)
)

const ServerLive = HttpLive.pipe(Layer.provide(DeskLive), Layer.provide(DeskConfig.layer))

const ClientLive = Layer.unwrap(
  Effect.gen(function* () {
    const url = yield* Config.String("REVIEW_DESK_URL").pipe(Config.withDefault("http://127.0.0.1:4790"))

    return RpcClient.layerProtocolHttp({ url: `${url}/rpc` })
  })
).pipe(Layer.provide([FetchHttpClient.layer, RpcSerialization.layerNdjson]))

const makeClient = RpcClient.make(DeskRpcs)

const withDesk = <A, E>(use: (client: Effect.Success<typeof makeClient>) => Effect.Effect<A, E>) =>
  Effect.scoped(Effect.flatMap(makeClient, use)).pipe(Effect.provide(ClientLive))

const key = Argument.String("pull").pipe(
  Argument.withDescription("The pull request or issue, as forge:owner/repo#number"),
  Argument.withSchema(PrKey)
)

const serve = Command.make("serve", {}, () => Layer.launch(ServerLive)).pipe(
  Command.withDescription("Run the desk: poll, route, deliver and serve the board")
)

const comment = Command.make(
  "comment",
  {
    key,
    body: Flag.String("body").pipe(Flag.withDescription("What to say")),
    replyTo: Flag.String("reply-to").pipe(
      Flag.withDescription("The comment id to answer in its thread"),
      Flag.optional
    ),
    path: Flag.String("path").pipe(Flag.withDescription("File for a new inline comment"), Flag.optional),
    line: Flag.Int("line").pipe(Flag.withDescription("Line for a new inline comment"), Flag.optional),
    outcome: Flag.Literals("outcome", CommentOutcome.literals).pipe(
      Flag.withDescription("Settle the thread"),
      Flag.withDefault("open")
    ),
    close: Flag.Boolean("close").pipe(
      Flag.withDescription("On an issue, close it after the comment"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* (input) {
    const posted = yield* withDesk((client) =>
      client.PostComment({
        key: input.key,
        body: Text.make(input.body),
        outcome: input.outcome,
        replyTo: Option.getOrNull(Option.map(input.replyTo, Text.make)),
        path: Option.getOrNull(Option.map(input.path, Text.make)),
        line: Option.getOrNull(input.line),
        close: input.close
      })
    )
    yield* Console.log(`posted ${posted.url}`)
  })
).pipe(Command.withDescription("Post a comment through the desk, with the agent label and the round"))

const triage = Command.make(
  "triage",
  {
    key,
    verdict: Flag.Literals("verdict", Verdict.literals).pipe(Flag.withDescription("architecture, look or skim")),
    reason: Flag.String("reason").pipe(Flag.withDescription("One line for the person who reads it next"))
  },
  Effect.fn(function* (input) {
    yield* withDesk((client) =>
      client.ReportTriage({ key: input.key, verdict: input.verdict, reason: Text.make(input.reason), settled: [] })
    )
    yield* Console.log(`reported ${input.verdict} for ${input.key}`)
  })
).pipe(Command.withDescription("Report the review verdict for the human queue"))

const envOption = (name: string) => Config.option(Config.String(name))

const claudeSessionOf = (socket: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const home = yield* Config.String("HOME").pipe(Config.withDefault("."))
    const claudeHome = yield* Config.String("CLAUDE_CONFIG_DIR").pipe(Config.withDefault(path.join(home, ".claude")))
    const directory = path.join(claudeHome, "sessions")
    const files = yield* fs.readDirectory(directory)
    const read = (file: string) =>
      fs
        .readFileString(path.join(directory, file))
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ClaudeSession))), Effect.option)
    const sessions = yield* Effect.forEach(
      files.filter((file) => file.endsWith(".json")),
      read,
      { concurrency: 8 }
    )

    return Option.map(
      Option.fromNullishOr(sessions.flatMap(Option.toArray).find((session) => session.messagingSocketPath === socket)),
      (session) => session.sessionId
    )
  }).pipe(Effect.orElseSucceed(() => Option.none<string>()))

const callerTerminal = Effect.gen(function* () {
  const socket = yield* envOption("CLAUDE_CODE_MESSAGING_SOCKET")
  const claudeSession = yield* Option.match(socket, {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: claudeSessionOf
  })
  const rexSession = yield* envOption("REX_SESSION")
  const rexBlock = yield* envOption("REX_BLOCK")

  return callerAddress({
    herdrPane: yield* envOption("HERDR_PANE_ID"),
    appTerminal: yield* envOption("HC_TERMINAL_ID"),
    cmuxWorkspace: yield* envOption("CMUX_WORKSPACE_ID"),
    orcaTerminal: yield* envOption("ORCA_TERMINAL_HANDLE"),
    rexBlock: Option.zipWith(rexSession, rexBlock, (session, block) => ({ session, block })),
    tmuxPane: yield* envOption("TMUX_PANE"),
    claudeSession
  })
})

const claimPull = Effect.fnUntraced(function* (target: string, session: Option.Option<string>, role: Role) {
  const pull = yield* Schema.decodeEffect(PrKey)(target)
  const caller = yield* callerTerminal
  const chosen = Option.orElse(session, () => caller)
  yield* withDesk((client) =>
    client.Claim({ key: pull, session: Option.getOrNull(Option.map(chosen, SessionName.make)), role })
  )
  const forWho = Option.match(chosen, { onNone: () => "", onSome: (who) => ` for ${who}` })
  yield* Console.log(`claimed ${pull} as ${role}${forWho}`)
})

type IssueClaimInput = {
  readonly target: string
  readonly from: ReadonlyArray<string>
  readonly pane: Option.Option<string>
  readonly machine: Option.Option<string>
  readonly release: boolean
}

class NoAuthors extends Schema.TaggedError<NoAuthors, { readonly brand: unique symbol }>()("NoAuthors", {}) {
  override get message() {
    return "say whose issues to deliver: pass --from <login> at least once"
  }
}

class NoPane extends Schema.TaggedError<NoPane, { readonly brand: unique symbol }>()("NoPane", {}) {
  override get message() {
    return "no terminal: run this in a Herdr pane, a Herdr app terminal, cmux, Orca, tmux or Claude Code, or pass --pane"
  }
}

const paneOf = (input: IssueClaimInput) =>
  Effect.flatMap(callerTerminal, (fromEnv) =>
    Effect.fromOption(Option.orElse(input.pane, () => fromEnv)).pipe(Effect.mapError(() => new NoPane()))
  )

const claimIssues = Effect.fnUntraced(function* (input: IssueClaimInput) {
  const repo = yield* Schema.decodeEffect(RepoSlug)(input.target)
  const pane = yield* paneOf(input)
  const machine = Option.getOrNull(input.machine)
  const where = machine === null ? pane : `${pane} on ${machine}`
  if (input.release) {
    const done = yield* withDesk((client) => client.ReleaseIssues({ repo, machine, pane }))

    return yield* Console.log(`released ${done.released} issue claim(s) on ${repo} for ${where}`)
  }
  const from = yield* Schema.decodeUnknownEffect(Schema.NonEmptyArray(Login))(input.from).pipe(
    Effect.mapError(() => new NoAuthors())
  )
  const claimed = yield* withDesk((client) => client.ClaimIssues({ repo, from, machine, pane }))
  yield* Console.log(`watching ${repo} issues on ${claimed.forges.join(" and ")} from ${from.join(", ")} for ${where}`)
})

const claim = Command.make(
  "claim",
  {
    target: Argument.String("target").pipe(
      Argument.withDescription("A pull request as forge:owner/repo#number, or with --issues a repository as owner/repo")
    ),
    as: Flag.Literals("as", Role.literals).pipe(
      Flag.withDescription(
        "reviewer (replies to your threads, new pushes) or author (failed CI, review comments to address)"
      ),
      Flag.withDefault("reviewer")
    ),
    session: Flag.String("session").pipe(
      Flag.withDescription(
        "Agent to hand a pull request to: a Herdr agent name or a terminal address (default: this terminal)"
      ),
      Flag.optional
    ),
    issues: Flag.Boolean("issues").pipe(
      Flag.withDescription("Claim the repository's issues for this pane"),
      Flag.withDefault(false)
    ),
    from: Flag.String("from").pipe(
      Flag.withDescription("Author whose issues and comments reach the pane (repeat for more)"),
      Flag.atLeast(0)
    ),
    pane: Flag.String("pane").pipe(
      Flag.withDescription(
        "Terminal to deliver to: a Herdr pane, or hc:<t>, cmux:<id>, orca:<id>, rex:<session>/<block>, tmux:<pane>, claude:<session> (default: this terminal)"
      ),
      Flag.optional
    ),
    machine: Flag.String("machine").pipe(
      Flag.withDescription("Herdr machine label of that pane when it is on another machine, such as devbox"),
      Flag.optional
    ),
    release: Flag.Boolean("release").pipe(
      Flag.withDescription("With --issues, stop watching the repository's issues"),
      Flag.withDefault(false)
    )
  },
  Effect.fn(function* (input) {
    if (input.issues) return yield* claimIssues(input)

    return yield* claimPull(input.target, input.session, input.as)
  })
).pipe(Command.withDescription("Claim a pull request for an agent to review, or a repository's issues for this pane"))

const sketchybar = Command.make(
  "sketchybar",
  {},
  Effect.fn(function* () {
    const shell = yield* Shell
    const trigger = (summary: Summary) =>
      shell
        .run("sketchybar", [
          "--trigger",
          "review_desk_update",
          `READY=${summary.needsYou}`,
          `WORKING=${summary.agents.working}`,
          `TALKING=${summary.agents.talking}`,
          `HEALTH=${summary.health.state}`
        ])
        .pipe(Effect.ignore)
    yield* shell.run("sketchybar", ["--add", "event", "review_desk_update"]).pipe(Effect.ignore)
    yield* withDesk((client) => client.WatchSummary().pipe(Stream.runForEach(trigger)))
  }, Effect.provide(Shell.layer))
).pipe(Command.withDescription("Keep SketchyBar's review_desk_update event fed with the counts"))

const seen = Command.make(
  "seen",
  { key },
  Effect.fn(function* (input) {
    yield* withDesk((client) => client.MarkSeen({ key: input.key }))
    yield* Console.log(`marked ${input.key} seen; it leaves Needs you until something new happens on it`)
  })
).pipe(Command.withDescription("Clear a pull request or issue from Needs you without replying"))

const agentLine = (agent: AgentRow): string =>
  [agent.name, agent.host, agent.status, agent.machine ?? "here", agent.pane, agent.cwd].join("\t")

const listAgents = withDesk((client) => client.ListAgents()).pipe(
  Effect.flatMap((listing) =>
    Console.log(
      [
        ...listing.agents.map(agentLine),
        `${listing.agents.length} agents; hosts that answered: ${listing.reached.join(", ") || "none"}`
      ].join("\n")
    )
  )
)

const agents = Command.make(
  "agents",
  {
    read: Flag.String("read").pipe(
      Flag.withDescription("Print the recent screen of this agent, by name or terminal address"),
      Flag.optional
    ),
    lines: Flag.Int("lines").pipe(Flag.withDescription("How many lines --read prints"), Flag.withDefault(40))
  },
  Effect.fn(function* (input) {
    const agent = Option.getOrNull(input.read)
    if (agent === null) return yield* listAgents
    const screen = yield* withDesk((client) => client.ReadAgent({ agent, lines: input.lines }))
    yield* Console.log(screen.text)
  })
).pipe(
  Command.withDescription(
    "List the agents the desk can hand work to, in every terminal host (name, host, status, machine, address, folder)"
  )
)

const SummaryJson = Schema.fromJsonString(Summary)

const summary = Command.make("summary", {}, () =>
  withDesk((client) =>
    client.WatchSummary().pipe(
      Stream.take(1),
      Stream.runForEach((value) => Schema.encodeEffect(SummaryJson)(value).pipe(Effect.flatMap(Console.log)))
    )
  )
).pipe(Command.withDescription("Print the counts once"))

const cli = Command.make("review-desk").pipe(
  Command.withDescription("Agents do the first review rounds; you get a queue of what needs a person"),
  Command.withSubcommands([serve, comment, triage, claim, seen, agents, sketchybar, summary])
)

const messageOf = (cause: Cause.Cause<unknown>): string =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => Cause.pretty(cause),
    onSome: (error) => (error instanceof Error && error.message.length > 0 ? error.message : Cause.pretty(cause))
  })

cli.pipe(
  Command.run({ version: "0.4.0" }),
  Effect.tapCause((cause) => (Cause.hasInterruptsOnly(cause) ? Effect.void : Console.error(messageOf(cause)))),
  Effect.provide(BunServices.layer),
  BunRuntime.runMain
)
