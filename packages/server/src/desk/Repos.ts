import { type Forge, RepoSlug } from "@review-desk/contract/Ids.ts"

export type RepoRef = { readonly forge: Forge; readonly slug: RepoSlug }

export type FoundRepo = {
  readonly full_name: string
  readonly owner: { readonly login: string }
  readonly archived: boolean
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export const withDiscovered = (
  listed: ReadonlyArray<RepoRef>,
  forge: Forge,
  discovered: ReadonlyArray<RepoSlug>
): ReadonlyArray<RepoRef> => [
  ...listed,
  ...discovered
    .filter((slug) => !listed.some((entry) => entry.forge === forge && same(entry.slug, slug)))
    .map((slug) => ({ forge, slug }))
]

export const ownedBy = (found: ReadonlyArray<FoundRepo>, logins: ReadonlyArray<string>): ReadonlyArray<RepoSlug> =>
  found
    .filter((repo) => !repo.archived && logins.some((login) => same(login, repo.owner.login)))
    .map((repo) => RepoSlug.make(repo.full_name))
