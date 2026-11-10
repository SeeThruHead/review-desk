import { assert, describe, it } from "@effect/vitest"
import { BunServices } from "@effect/platform-bun"
import { Effect, FileSystem } from "effect"
import { main, offendingLines } from "./attribution.ts"

const git = (args: ReadonlyArray<string>) =>
  Effect.promise(() => new Response(Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "ignore" }).stdout).text())

const guardFiles = new Set(["packages/lint/tools/attribution.ts", "packages/lint/tools/attribution.test.ts"])

const trackedText = Effect.gen(function* () {
  const root = (yield* git(["rev-parse", "--show-toplevel"])).trim()
  const files = (yield* git(["-C", root, "ls-files"]))
    .split("\n")
    .filter((file) => file.length > 0)
    .filter((file) => !guardFiles.has(file))

  return yield* Effect.forEach(files, (file) => Effect.promise(() => Bun.file(`${root}/${file}`).text()), {
    concurrency: 16
  })
})

describe("AI attribution guard", () => {
  it("flags attribution trailers and footers", () => {
    const message = [
      "Add habit groups",
      "",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
      "Generated with Claude Code",
      "Claude-Session: https://claude.ai/code/session_01ABC",
      "https://claude.ai/code/session_01ABC"
    ].join("\n")

    assert.deepStrictEqual(offendingLines(message), message.split("\n").slice(2))
  })

  it("leaves ordinary messages alone", () => {
    assert.deepStrictEqual(offendingLines("Co-authored-by: A Person <person@example.com>\nGenerated migrations"), [])
  })

  it.effect("no tracked file carries attribution", () =>
    Effect.gen(function* () {
      const texts = yield* trackedText

      assert.deepStrictEqual(texts.flatMap(offendingLines), [])
    })
  )

  it.effect("no commit message in history carries attribution", () =>
    Effect.gen(function* () {
      const history = yield* git(["log", "--format=%B"])

      assert.deepStrictEqual(offendingLines(history), [])
    })
  )
})

const messageFile = Effect.fnUntraced(function* (text: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* fs.makeTempFileScoped({ prefix: "attribution-" })
  yield* fs.writeFileString(path, text)

  return path
})

describe("attribution commit hook", () => {
  it.effect("accepts an ordinary message and rejects one with an AI trailer", () =>
    Effect.gen(function* () {
      const clean = yield* messageFile("Add habit groups\n")
      const tainted = yield* messageFile("Add habit groups\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n")

      yield* main(["bun", "hook", clean])
      const error = yield* main(["bun", "hook", tainted]).pipe(Effect.flip)

      assert.strictEqual(error._tag, "AttributionFound")
      assert.include(error.message, "Co-Authored-By: Claude")
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer))
  )

  it.effect("explains a missing argument and an unreadable file", () =>
    Effect.gen(function* () {
      const usage = yield* main(["bun", "hook"]).pipe(Effect.flip)
      const unreadable = yield* main(["bun", "hook", "/nonexistent/COMMIT_EDITMSG"]).pipe(Effect.flip)

      assert.strictEqual(usage._tag, "Usage")
      assert.include(usage.message, "<commit-message-file>")
      assert.strictEqual(unreadable._tag, "MessageUnreadable")
    })
  )
})
