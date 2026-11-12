import type { RepoSlug } from "@review-desk/contract/Ids.ts"

export type Searches = {
  readonly involved: string
  readonly requested: string
  readonly reviewed: string
  readonly labelled: string
  readonly merged: string
  readonly mentioned: string
}

export const searchesFor = (repo: RepoSlug, intakeLabel: string, login = "@me"): Searches => ({
  involved: `repo:${repo} is:pr is:open involves:${login}`,
  requested: `repo:${repo} is:pr is:open review-requested:${login}`,
  reviewed: `repo:${repo} is:pr is:open reviewed-by:${login}`,
  labelled: `repo:${repo} is:pr is:open label:"${intakeLabel}"`,
  merged: `repo:${repo} is:pr is:merged involves:${login} sort:updated-desc`,
  mentioned: `repo:${repo} is:issue is:open mentions:${login} sort:updated-desc`
})

export const uniqueByNumber = <A extends { readonly number: number }>(found: ReadonlyArray<A>): ReadonlyArray<A> =>
  found.filter((pull, index) => found.findIndex((other) => other.number === pull.number) === index)
