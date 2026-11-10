import { assert, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

const Report = Schema.fromJsonString(
  Schema.Struct({
    diagnostics: Schema.Array(
      Schema.Struct({
        code: Schema.String,
        filename: Schema.String,
        labels: Schema.Array(Schema.Struct({ span: Schema.Struct({ line: Schema.Int }) }))
      })
    )
  })
)

const expected = [
  "casts.ts house(no-casts) 1",
  "comments.ts house(no-comments) 1",
  "deterministic.ts house(deterministic) 1",
  "deterministic.ts house(deterministic) 2",
  "gen-wrapper.ts house(no-gen-wrapper) 2",
  "let.ts house(no-let) 2",
  "loops.ts house(no-loops) 3",
  "loops.ts house(no-mutation) 3",
  "multiline-logical.ts house(no-multiline-logical) 2",
  "mutation.ts house(no-mutation) 2",
  "mutation.ts house(no-mutation) 3",
  "nested-if.ts house(no-nested-if) 3",
  "packages/domain/src/Lifecycle.ts house(boundaries) 1",
  "packages/domain/src/Lifecycle.ts house(boundaries) 2",
  "packages/server/src/Handlers.ts house(transports-from-contract) 2",
  "packages/server/src/forge/GitHub.ts house(boundaries) 1",
  "packages/web/src/pages/board/io.ts house(boundaries) 1",
  "packages/web/src/pages/board/view.ts house(markup-in-components) 2",
  "run.ts house(run-at-entry-only) 2"
]

class NoReport extends Schema.TaggedError<NoReport, { readonly brand: unique symbol }>()("NoReport", {
  hint: Schema.String,
  stderr: Schema.String
}) {}

const textOf = (stream: ReadableStream<Uint8Array>) => Effect.promise(() => new Response(stream).text())

const lintFixtures = Effect.gen(function* () {
  const child = Bun.spawn(
    ["./node_modules/.bin/oxlint", "--no-ignore", "-c", "fixtures.oxlintrc.json", "-f", "json", "fixtures"],
    { stdout: "pipe", stderr: "pipe" }
  )
  const [stdout, stderr] = yield* Effect.all([textOf(child.stdout), textOf(child.stderr)])

  return yield* Schema.decodeEffect(Report)(stdout).pipe(
    Effect.mapError(() => new NoReport({ hint: "oxlint printed no report; run `bun run setup` to patch it", stderr }))
  )
})

it.effect("each house rule reports exactly the fixture lines it should, and clean code reports nothing", () =>
  Effect.gen(function* () {
    const report = yield* lintFixtures
    const found = report.diagnostics
      .map((d) => `${d.filename.replace(/^.*fixtures\//, "")} ${d.code} ${d.labels[0]?.span.line ?? 0}`)
      .toSorted()

    assert.deepStrictEqual(found, expected)
  })
)
