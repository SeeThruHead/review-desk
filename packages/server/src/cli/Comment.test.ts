import { describe, expect, it } from "@effect/vitest"
import type { CommentRequest } from "@review-desk/contract/Contract.ts"
import { Url } from "@review-desk/contract/Ids.ts"
import { Effect, FileSystem, Layer, Path, Ref, Stdio, Terminal } from "effect"
import { Command } from "effect/cli"
import { ChildProcessSpawner } from "effect/process"
import { commentCommand } from "./Comment.ts"

const CliTest = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      size: Effect.die("unused"),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void
    })
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("unused"))
  )
)

const requestFor = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sent = yield* Ref.make<ReadonlyArray<CommentRequest>>([])
    const command = commentCommand((request) =>
      Ref.update(sent, (all) => [...all, request]).pipe(Effect.as({ url: Url.make("https://example.test/c/1") }))
    )
    yield* Command.runWith(command, { version: "0.0.0" })(args)

    return yield* Ref.get(sent)
  }).pipe(Effect.provide(CliTest))

describe("review-desk comment", () => {
  it.effect("sends a directed comment when --directed is given", () =>
    Effect.gen(function* () {
      const sent = yield* requestFor(["github:o/r#1", "--body", "Approved text", "--directed"])
      expect(sent.map((request) => request.directed)).toEqual([true])
    })
  )

  it.effect("leaves the request as before without --directed", () =>
    Effect.gen(function* () {
      const sent = yield* requestFor(["github:o/r#1", "--body", "Agent text"])
      expect(sent.map((request) => "directed" in request)).toEqual([false])
    })
  )
})
