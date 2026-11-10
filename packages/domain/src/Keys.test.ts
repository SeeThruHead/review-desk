import { describe, expect, it } from "@effect/vitest"
import { PrKey } from "@review-desk/contract/Ids.ts"
import { keyParts } from "./Keys.ts"

describe("reading a pull request or issue key", () => {
  it("splits it into forge, repository and number", () => {
    expect(keyParts(PrKey.make("gitea:you/bot#12"))).toEqual({ forge: "gitea", repo: "you/bot", number: 12 })
    expect(keyParts(PrKey.make("github:acme/api#7"))).toEqual({ forge: "github", repo: "acme/api", number: 7 })
  })
})
