import { Forge, Login, RepoSlug, SessionName } from "@review-desk/contract/Ids.ts"
import { Config, Context, Effect, FileSystem, Layer, Schema } from "effect"
import { outsideOwners } from "../desk/Repos.ts"

export const RepoRef = Schema.Struct({ forge: Forge, slug: RepoSlug })
export type RepoRef = typeof RepoRef.Type

export const Area = Schema.Struct({
  name: Schema.String,
  session: SessionName,
  repos: Schema.Array(RepoSlug),
  paths: Schema.optionalKey(Schema.Array(Schema.String))
})
export type Area = typeof Area.Type

export const Role = Schema.Literals(["author", "reviewer"])

export const DeskSettings = Schema.Struct({
  desk: Login,
  aliases: Schema.Array(Login),
  owner: Schema.String,
  roles: Schema.Array(Role),
  repos: Schema.Array(RepoRef),
  people: Schema.Array(Login),
  areas: Schema.Array(Area),
  roundLimit: Schema.Int,
  intakeLabel: Schema.String,
  pollSeconds: Schema.Int,
  port: Schema.Int,
  sidediff: Schema.NullOr(Schema.Struct({ checkouts: Schema.Record(Schema.String, Schema.String) })),
  github: Schema.Struct({
    api: Schema.String,
    tokenCommand: Schema.Array(Schema.String),
    login: Schema.optionalKey(Schema.String)
  }),
  gitea: Schema.NullOr(
    Schema.Struct({ url: Schema.String, tokenFile: Schema.String, discoverOwned: Schema.optionalKey(Schema.Boolean) })
  ),
  machines: Schema.optionalKey(Schema.Array(Schema.Struct({ label: Schema.String, seat: Schema.String }))),
  owners: Schema.optionalKey(Schema.Array(Schema.String))
})
export type DeskSettings = typeof DeskSettings.Type

export class ConfigUnreadable extends Schema.TaggedError<ConfigUnreadable, { readonly brand: unique symbol }>()(
  "ConfigUnreadable",
  { path: Schema.String, reason: Schema.String }
) {
  override get message() {
    return `Review Desk could not read its config at ${this.path}: ${this.reason}`
  }
}

export class DeskConfig extends Context.Service<DeskConfig, DeskSettings & { readonly home: string }>()(
  "review-desk/server/DeskConfig"
) {
  static readonly layer = Layer.effect(
    DeskConfig,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const userHome = yield* Config.String("HOME").pipe(Config.withDefault("."))
      const home = yield* Config.String("REVIEW_DESK_HOME").pipe(Config.withDefault(`${userHome}/.review-desk`))
      const path = `${home}/config.json`
      const text = yield* fs
        .readFileString(path)
        .pipe(Effect.mapError((error) => new ConfigUnreadable({ path, reason: error.message })))
      const settings = yield* Schema.decodeEffect(Schema.fromJsonString(DeskSettings))(text).pipe(
        Effect.mapError((error) => new ConfigUnreadable({ path, reason: error.message }))
      )

      const outside = outsideOwners(settings.repos, settings.owners)
      if (outside.length > 0)
        return yield* new ConfigUnreadable({
          path,
          reason: `repos lists ${outside.map((entry) => entry.slug).join(", ")}, outside owners (${(settings.owners ?? []).join(", ")}); remove them or add their owner to owners`
        })

      return DeskConfig.of({ ...settings, home })
    })
  )
}
