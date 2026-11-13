import { Effect, Option, Schema } from "effect"
import { type AgentHost, type Found, type HostEnv, decodeJson, statusOf } from "../Host.ts"

export const ClaudeSession = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  status: Schema.optionalKey(Schema.String),
  messagingSocketPath: Schema.optionalKey(Schema.String)
})

export type ClaudeSession = typeof ClaudeSession.Type

export const sessionAgents = (sessions: ReadonlyArray<ClaudeSession>): ReadonlyArray<Found> =>
  sessions.map((session) => ({
    pane: `claude:${session.sessionId}`,
    cwd: session.cwd,
    status: statusOf(session.status)
  }))

export const InboxLine = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({ role: Schema.Literal("user"), content: Schema.String })
})

const inboxJson = Schema.encodeSync(Schema.fromJsonString(InboxLine))

export const inboxLine = (text: string): string =>
  `${inboxJson({ type: "user", message: { role: "user", content: text } })}\n`

const readSession = (env: HostEnv, file: string) =>
  env.files.readText(file).pipe(decodeJson(ClaudeSession), Effect.option)

const hasInbox = (env: HostEnv) => (session: ClaudeSession) =>
  session.messagingSocketPath === undefined ? Effect.succeed(false) : env.files.exists(session.messagingSocketPath)

const liveSessions = (env: HostEnv, directory: string) =>
  env.files.list(directory).pipe(
    Effect.flatMap((files) =>
      Effect.forEach(
        files.filter((file) => file.endsWith(".json")),
        (file) => readSession(env, `${directory}/${file}`),
        { concurrency: 8 }
      )
    ),
    Effect.map((found) => found.flatMap(Option.toArray)),
    Effect.flatMap((sessions) => Effect.filter(sessions, hasInbox(env), { concurrency: 8 }))
  )

const noInbox = { message: "the session has no inbox socket" }

export const claudeHost = (sessionsDirectory: string): AgentHost => ({
  name: "claude",
  title: "Claude Code",
  yieldsToTerminals: true,
  list: (env) => Effect.map(liveSessions(env, sessionsDirectory), sessionAgents),
  send: (env, target, text) =>
    liveSessions(env, sessionsDirectory).pipe(
      Effect.map((sessions) => sessions.find((session) => session.sessionId === target.id)?.messagingSocketPath),
      Effect.flatMap((socket) => (socket === undefined ? Effect.fail(noInbox) : env.postLine(socket, inboxLine(text))))
    ),
  read: () => Effect.fail({ message: "a Claude Code session has no screen" })
})
