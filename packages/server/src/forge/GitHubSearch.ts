import type { RepoSlug } from "@review-desk/contract/Ids.ts"

export type Searches = {
  readonly involved: string
  readonly requested: string
  readonly reviewed: string
  readonly labelled: string
  readonly merged: string
}

export const searchesFor = (repo: RepoSlug, intakeLabel: string): Searches => ({
  involved: `repo:${repo} is:pr is:open involves:@me`,
  requested: `repo:${repo} is:pr is:open review-requested:@me`,
  reviewed: `repo:${repo} is:pr is:open reviewed-by:@me`,
  labelled: `repo:${repo} is:pr is:open label:"${intakeLabel}"`,
  merged: `repo:${repo} is:pr is:merged involves:@me sort:updated-desc`
})

export const uniqueByNumber = <A extends { readonly number: number }>(found: ReadonlyArray<A>): ReadonlyArray<A> =>
  found.filter((pull, index) => found.findIndex((other) => other.number === pull.number) === index)
