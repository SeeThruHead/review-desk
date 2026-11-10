import { BunRuntime } from "@effect/platform-bun"
import { main } from "./attribution.ts"

BunRuntime.runMain(main(Bun.argv))
