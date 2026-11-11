import { describe, expect, layer } from "@effect/vitest"
import { Login, PrKey, RepoSlug, SessionName, Text } from "@review-desk/contract/Ids.ts"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { DatabaseInMemory } from "./Database.ts"
import { DeskRepo } from "./DeskRepo.ts"

const pull = PrKey.make("github:acme/api#1")

describe("the desk's own records", () => {
  layer(DeskRepo.layer.pipe(Layer.provideMerge(DatabaseInMemory)))((it) => {
    it.effect("keeps claims, triage, checks and seen items, and replaces a claim or a verdict when it changes", () =>
      Effect.gen(function* () {
        const repo = yield* DeskRepo
        yield* repo.claim(pull, SessionName.make("auth"), "reviewer")
        yield* repo.claim(pull, SessionName.make("ui-kit"), "author")
        yield* repo.saveTriage(pull, { verdict: "look", reason: Text.make("first") }, [])
        yield* repo.saveTriage(pull, { verdict: "skim", reason: Text.make("rename only") }, [
          { thread: Text.make("a.ts"), outcome: "fixed", note: Text.make("done") }
        ])
        yield* repo.remember(pull, "passed", ["c:1", "t:2"])
        yield* repo.remember(pull, "failed", ["t:2", "t:3"])
        const records = yield* repo.records

        expect(records.claims.get(pull)).toBe("ui-kit")
        expect(records.claimRoles.get(pull)).toBe("author")
        expect(records.triage.get(pull)).toEqual({
          triage: { verdict: "skim", reason: "rename only" },
          settled: [{ thread: "a.ts", outcome: "fixed", note: "done" }]
        })
        expect(records.known.get(pull)).toBe("failed")
        expect([...records.seen].toSorted()).toEqual([`${pull} c:1`, `${pull} t:2`, `${pull} t:3`])
      })
    )

    it.effect("remembers what each branch's CI has done, replacing it on every look", () =>
      Effect.gen(function* () {
        const repo = yield* DeskRepo
        yield* repo.saveBranch("you/infra@main", { done: [1], failing: ["ci.yml"] })
        yield* repo.saveBranch("you/infra@main", { done: [1, 2], failing: [] })
        yield* repo.saveBranch("you/app@main", { done: [], failing: [] })
        const branches = yield* repo.branches

        expect(branches.get("you/infra@main")).toEqual({ done: [1, 2], failing: [] })
        expect(branches.size).toBe(2)
      })
    )

    it.effect("keeps issue claims, marks them as first seen, remembers their items and releases them", () =>
      Effect.gen(function* () {
        const repo = yield* DeskRepo
        const claim = {
          id: "gitea:you/bot@devbox/wQ:p3",
          forge: "gitea" as const,
          repo: RepoSlug.make("you/bot"),
          from: [Login.make("review-bot")],
          target: { machine: "devbox", pane: "wQ:p3" }
        }
        yield* repo.claimIssues(claim)
        yield* repo.markBaselined(claim.id)
        yield* repo.claimIssues({ ...claim, from: [Login.make("review-bot"), Login.make("dana-gitea")] })
        yield* repo.rememberIssueItems(claim.id, ["issue:12", "comment:5"])

        const claims = yield* repo.issueClaims
        const records = yield* repo.records
        const first = yield* repo.releaseIssues(claim.id)
        const second = yield* repo.releaseIssues(claim.id)
        const after = yield* repo.issueClaims

        expect(claims).toEqual([{ ...claim, from: ["review-bot", "dana-gitea"], baselined: true }])
        expect([...records.seen]).toEqual(expect.arrayContaining([`${claim.id} issue:12`, `${claim.id} comment:5`]))
        expect([first, second]).toEqual([true, false])
        expect(after).toEqual([])
      })
    )

    it.effect("reports a broken database as the repository's own error", () =>
      Effect.gen(function* () {
        const repo = yield* DeskRepo
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe("DROP TABLE claims")
        const error = yield* Effect.flip(repo.claim(pull, SessionName.make("x"), "reviewer"))
        expect(error._tag).toBe("DeskRepoError")
        expect(error.message).toBe("Review Desk could not read or write its own records")
      })
    )
  })
})
