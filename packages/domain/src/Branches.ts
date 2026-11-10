import { Text, Url } from "@review-desk/contract/Ids.ts"
import { Schema } from "effect"

export const Run = Schema.Struct({
  id: Schema.Int,
  workflow: Text,
  title: Text,
  url: Url,
  done: Schema.Boolean,
  outcome: Schema.Literals(["passed", "failed", "other"])
})
export type Run = typeof Run.Type

export const SeenBranch = Schema.Struct({ done: Schema.Array(Schema.Int), failing: Schema.Array(Schema.String) })
export type SeenBranch = typeof SeenBranch.Type

export type BranchChange = { readonly kind: "failed" | "fixed"; readonly run: Run }

const settled = (runs: ReadonlyArray<Run>): ReadonlyArray<Run> =>
  runs.filter((run) => run.done).toSorted((left, right) => left.id - right.id)

const failingAfter = (failing: ReadonlyArray<string>, run: Run): ReadonlyArray<string> => {
  const others = failing.filter((workflow) => workflow !== run.workflow)
  if (run.outcome === "failed") return [...others, run.workflow]
  if (run.outcome === "passed") return others

  return failing
}

const changeOf = (failing: ReadonlyArray<string>, run: Run): ReadonlyArray<BranchChange> => {
  if (run.outcome === "failed") return [{ kind: "failed", run }]
  if (run.outcome === "passed" && failing.includes(run.workflow)) return [{ kind: "fixed", run }]

  return []
}

export const branchChanges = (
  runs: ReadonlyArray<Run>,
  seen: SeenBranch | undefined
): { readonly changes: ReadonlyArray<BranchChange>; readonly next: SeenBranch } => {
  const done = settled(runs)
  if (seen === undefined)
    return { changes: [], next: { done: done.map((run) => run.id), failing: done.reduce(failingAfter, []) } }
  const known = new Set(seen.done)
  const walked = done
    .filter((run) => !known.has(run.id))
    .reduce<{ readonly failing: ReadonlyArray<string>; readonly changes: ReadonlyArray<BranchChange> }>(
      (state, run) => ({
        failing: failingAfter(state.failing, run),
        changes: [...state.changes, ...changeOf(state.failing, run)]
      }),
      { failing: seen.failing, changes: [] }
    )

  return { changes: walked.changes, next: { done: done.map((run) => run.id), failing: walked.failing } }
}
