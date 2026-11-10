import { describe, expect, it } from "@effect/vitest"
import { RepoSlug } from "@review-desk/contract/Ids.ts"
import { ownedBy, withDiscovered } from "./Repos.ts"

const listed = [
  { forge: "github" as const, slug: RepoSlug.make("acme/api") },
  { forge: "gitea" as const, slug: RepoSlug.make("you/infra") }
]

describe("the repositories the desk watches", () => {
  it("adds the repositories found on the forge to the listed ones, once each", () => {
    expect(withDiscovered(listed, "gitea", [RepoSlug.make("You/Infra"), RepoSlug.make("you/new-app")])).toEqual([
      ...listed,
      { forge: "gitea", slug: "you/new-app" }
    ])
  })

  it("keeps a repository with the same name on another forge apart", () => {
    expect(withDiscovered(listed, "gitea", [RepoSlug.make("acme/api")])).toEqual([
      ...listed,
      { forge: "gitea", slug: "acme/api" }
    ])
  })

  it("keeps only the live repositories owned by the desk's logins", () => {
    const found = [
      { full_name: "you/infra", owner: { login: "you" }, archived: false },
      { full_name: "you/old", owner: { login: "you" }, archived: true },
      { full_name: "friend/shared", owner: { login: "friend" }, archived: false },
      { full_name: "You-Gitea/tool", owner: { login: "You-Gitea" }, archived: false }
    ]

    expect(ownedBy(found, ["you", "you-gitea"])).toEqual(["you/infra", "You-Gitea/tool"])
  })
})
