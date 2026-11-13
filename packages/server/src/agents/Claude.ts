import { Schema } from "effect"
import { type Found, statusOf } from "./Host.ts"

export const ClaudeSession = Schema.Struct({
  sessionId: Schema.String,
  cwd: Schema.String,
  status: Schema.optionalKey(Schema.String),
  messagingSocketPath: Schema.optionalKey(Schema.String)
})

export type ClaudeSession = typeof ClaudeSession.Type

export const claudeAgents = (
  sessions: ReadonlyArray<ClaudeSession>,
  terminals: ReadonlyArray<Found>
): ReadonlyArray<Found> =>
  sessions
    .filter((session) => session.messagingSocketPath !== undefined)
    .filter((session) => !terminals.some((terminal) => terminal.cwd === session.cwd))
    .map((session) => ({ pane: `claude:${session.sessionId}`, cwd: session.cwd, status: statusOf(session.status) }))

export const InboxLine = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({ role: Schema.Literal("user"), content: Schema.String })
})

const inboxJson = Schema.encodeSync(Schema.fromJsonString(InboxLine))

export const inboxLine = (text: string): string =>
  `${inboxJson({ type: "user", message: { role: "user", content: text } })}\n`
