import { Effect, FileSystem, Layer } from "effect"
import { DeskConfig } from "../config/DeskConfig.ts"
import { Shell } from "../platform/Shell.ts"
import { Forges } from "./Forge.ts"
import { giteaClient } from "./Gitea.ts"
import { gitHubClient } from "./GitHub.ts"

const usesForge = (config: DeskConfig["Service"], forge: "github" | "gitea"): boolean =>
  config.repos.some((repo) => repo.forge === forge)

export const ForgesLive = Layer.effect(
  Forges,
  Effect.gen(function* () {
    const config = yield* DeskConfig
    const shell = yield* Shell
    const fs = yield* FileSystem.FileSystem
    const [command, ...args] = config.github.tokenCommand
    const github =
      usesForge(config, "github") && command !== undefined
        ? yield* shell
            .run(command, args)
            .pipe(
              Effect.flatMap((token) =>
                gitHubClient(
                  config.github.api,
                  token.trim(),
                  config.intakeLabel,
                  config.pollSeconds,
                  config.github.login ?? "@me"
                )
              )
            )
        : null
    const gitea =
      (usesForge(config, "gitea") || config.gitea?.discoverOwned === true) && config.gitea !== null
        ? yield* fs
            .readFileString(config.gitea.tokenFile)
            .pipe(Effect.flatMap((token) => giteaClient(config.gitea?.url ?? "", token.trim())))
        : null

    const giteaHost = config.gitea === null ? null : new URL(config.gitea.url).host

    return Forges.of({ github, gitea, giteaHost })
  })
)
