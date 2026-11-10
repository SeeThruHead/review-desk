import { describe, expect, it } from "@effect/vitest"
import { Login, RepoSlug } from "@review-desk/contract/Ids.ts"
import { isTrustedPerson, isTrustedRepo, mayReachAgent } from "./Trust.ts"

const rules = { repos: [{ forge: "github" as const, slug: RepoSlug.make("acme/api") }], people: [Login.make("lee")] }

describe("the trust gate", () => {
  it.prop(
    "nothing from a repository or person outside the lists ever reaches an agent",
    [RepoSlug, Login],
    ([repo, person]) => {
      const trustedRepo = repo.toLowerCase() === "acme/api"
      const trustedPerson = person.toLowerCase() === "lee"
      expect(mayReachAgent(rules, { forge: "github", repo }, person)).toBe(trustedRepo && trustedPerson)
    }
  )

  it("matches names without regard to case, and keeps forges apart", () => {
    expect(isTrustedRepo(rules, "github", RepoSlug.make("ACME/Api"))).toBe(true)
    expect(isTrustedRepo(rules, "gitea", RepoSlug.make("acme/api"))).toBe(false)
    expect(isTrustedPerson(rules, Login.make("Lee"))).toBe(true)
    expect(mayReachAgent(rules, { forge: "github", repo: RepoSlug.make("acme/api") }, Login.make("mallory"))).toBe(
      false
    )
  })
})
