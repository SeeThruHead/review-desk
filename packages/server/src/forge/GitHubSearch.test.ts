import { describe, expect, it } from "@effect/vitest"
import { RepoSlug } from "@review-desk/contract/Ids.ts"
import { searchesFor, uniqueByNumber } from "./GitHubSearch.ts"

describe("which GitHub pull requests the desk reads", () => {
  it("asks only for the ones that involve the desk's owner, so a busy repository's other pull requests never crowd them out", () => {
    expect(searchesFor(RepoSlug.make("acme/api"), "agent-review")).toEqual({
      involved: "repo:acme/api is:pr is:open involves:@me",
      requested: "repo:acme/api is:pr is:open review-requested:@me",
      reviewed: "repo:acme/api is:pr is:open reviewed-by:@me",
      labelled: 'repo:acme/api is:pr is:open label:"agent-review"',
      merged: "repo:acme/api is:pr is:merged involves:@me sort:updated-desc"
    })
  })

  it("keeps the first copy of a pull request that more than one search found", () => {
    const found = [
      { number: 2, from: "a" },
      { number: 1, from: "a" },
      { number: 2, from: "b" }
    ]

    expect(uniqueByNumber(found)).toEqual([
      { number: 2, from: "a" },
      { number: 1, from: "a" }
    ])
  })
})
