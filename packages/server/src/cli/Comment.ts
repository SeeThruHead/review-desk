import { CommentOutcome, type CommentRequest } from "@review-desk/contract/Contract.ts"
import { PrKey, Text, type Url } from "@review-desk/contract/Ids.ts"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

export type Post<E, R> = (request: CommentRequest) => Effect.Effect<{ readonly url: Url }, E, R>

const key = Argument.String("pull").pipe(
  Argument.withDescription("The pull request or issue, as forge:owner/repo#number"),
  Argument.withSchema(PrKey)
)

const flags = {
  key,
  body: Flag.String("body").pipe(Flag.withDescription("What to say")),
  replyTo: Flag.String("reply-to").pipe(Flag.withDescription("The comment id to answer in its thread"), Flag.optional),
  path: Flag.String("path").pipe(Flag.withDescription("File for a new inline comment"), Flag.optional),
  line: Flag.Int("line").pipe(Flag.withDescription("Line for a new inline comment"), Flag.optional),
  outcome: Flag.Literals("outcome", CommentOutcome.literals).pipe(
    Flag.withDescription("Settle the thread"),
    Flag.withDefault("open")
  ),
  close: Flag.Boolean("close").pipe(
    Flag.withDescription("On an issue, close it after the comment"),
    Flag.withDefault(false)
  ),
  directed: Flag.Boolean("directed").pipe(
    Flag.withDescription(
      "Label it AI-formatted, real-human-directed with an empty Human comment section, for a reply the owner read and approved. Only for text the owner directed"
    ),
    Flag.withDefault(false)
  )
}

export const commentCommand = <E, R>(post: Post<E, R>) =>
  Command.make(
    "comment",
    flags,
    Effect.fn(function* (input) {
      const posted = yield* post({
        key: input.key,
        body: Text.make(input.body),
        outcome: input.outcome,
        replyTo: Option.getOrNull(Option.map(input.replyTo, Text.make)),
        path: Option.getOrNull(Option.map(input.path, Text.make)),
        line: Option.getOrNull(input.line),
        close: input.close,
        ...(input.directed ? { directed: true } : {})
      })
      yield* Console.log(`posted ${posted.url}`)
    })
  ).pipe(
    Command.withDescription(
      "Post a comment through the desk, with the agent label and the round (or the directed label with --directed)"
    )
  )
