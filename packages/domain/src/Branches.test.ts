import { describe, expect, it } from "@effect/vitest"
import { Text, Url } from "@review-desk/contract/Ids.ts"
import { type Run, branchChanges } from "./Branches.ts"

const run = (id: number, workflow: string, outcome: Run["outcome"], done = true): Run => ({
  id,
  workflow: Text.make(workflow),
  title: Text.make(`run ${id}`),
  url: Url.make(`https://gitea.example/you/infra/actions/runs/${id}`),
  done,
  outcome
})

describe("CI runs on a branch with no pull request", () => {
  it("says nothing the first time it sees a branch and remembers what is already failing", () => {
    const result = branchChanges([run(1, "ci.yml", "failed"), run(2, "deploy.yml", "passed")], undefined)

    expect(result.changes).toEqual([])
    expect(result.next).toEqual({ done: [1, 2], failing: ["ci.yml"] })
  })

  it("reports a run that failed since the last look", () => {
    const result = branchChanges([run(1, "ci.yml", "passed"), run(2, "ci.yml", "failed")], {
      done: [1],
      failing: []
    })

    expect(result.changes).toEqual([{ kind: "failed", run: run(2, "ci.yml", "failed") }])
    expect(result.next).toEqual({ done: [1, 2], failing: ["ci.yml"] })
  })

  it("reports a failing workflow passing again, and not a workflow that was already passing", () => {
    const result = branchChanges([run(3, "ci.yml", "passed"), run(4, "deploy.yml", "passed")], {
      done: [1, 2],
      failing: ["ci.yml"]
    })

    expect(result.changes).toEqual([{ kind: "fixed", run: run(3, "ci.yml", "passed") }])
    expect(result.next.failing).toEqual([])
  })

  it("waits for a run to finish and ignores cancelled or skipped runs", () => {
    const result = branchChanges([run(5, "ci.yml", "other", false), run(6, "deploy.yml", "other")], {
      done: [],
      failing: ["deploy.yml"]
    })

    expect(result.changes).toEqual([])
    expect(result.next).toEqual({ done: [6], failing: ["deploy.yml"] })
  })

  it("walks the new runs oldest first, so a fail then a fix in one look reports both", () => {
    const result = branchChanges([run(8, "ci.yml", "passed"), run(7, "ci.yml", "failed")], { done: [], failing: [] })

    expect(result.changes.map((change) => change.kind)).toEqual(["failed", "fixed"])
    expect(result.next.failing).toEqual([])
  })
})
