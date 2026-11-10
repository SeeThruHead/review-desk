import * as Path from "node:path"
import { Config, Effect, FileSystem, Option } from "effect"

const devDist = Path.resolve(import.meta.dir, "../../../web/dist")

const embedded = (suffix: string): Option.Option<Blob> =>
  Option.fromNullishOr(Bun.embeddedFiles.find((file) => "name" in file && String(file.name).endsWith(suffix)))

export const asset = Effect.fnUntraced(function* (suffix: string, devPath: string) {
  const fs = yield* FileSystem.FileSystem
  const blob = embedded(suffix)
  if (Option.isSome(blob)) return yield* Effect.promise(() => blob.value.text())

  const dist = yield* Config.String("REVIEW_DESK_WEB").pipe(Config.withDefault(devDist))

  return yield* fs.readFileString(Path.join(dist, devPath))
})

export const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Review Desk</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>`
