import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { DeskSettings, defaultPollSeconds } from "./DeskConfig.ts"

const settings = {
  desk: "desk-bot",
  aliases: [],
  owner: "dana",
  roles: ["reviewer"],
  repos: [],
  people: [],
  areas: [],
  roundLimit: 3,
  intakeLabel: "desk",
  port: 4790,
  sidediff: null,
  github: { api: "https://api.github.com", tokenCommand: ["gh", "auth", "token"] },
  gitea: null
}

const decode = Schema.decodeUnknownEffect(DeskSettings)

describe("how often the desk polls", () => {
  it.effect("polls every 30 seconds when the config does not say", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(settings)
      expect([decoded.pollSeconds, defaultPollSeconds]).toEqual([30, 30])
    })
  )

  it.effect("keeps the interval the config sets", () =>
    Effect.gen(function* () {
      const decoded = yield* decode({ ...settings, pollSeconds: 180 })
      expect(decoded.pollSeconds).toBe(180)
    })
  )
})
