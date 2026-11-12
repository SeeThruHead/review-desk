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
  discovered: ReadonlyArray<RepoSlug>,
  owners?: ReadonlyArray<string>
): ReadonlyArray<RepoRef> => [
  ...listed,
  ...discovered
    .filter((slug) => !listed.some((entry) => entry.forge === forge && same(entry.slug, slug)))
    .filter((slug) => isWithin(owners, slug))
    .map((slug) => ({ forge, slug }))
]

export const ownedBy = (found: ReadonlyArray<FoundRepo>, logins: ReadonlyArray<string>): ReadonlyArray<RepoSlug> =>
  found
    .filter((repo) => !repo.archived && logins.some((login) => same(login, repo.owner.login)))
    .map((repo) => RepoSlug.make(repo.full_name))

const ownerOf = (slug: string): string => slug.slice(0, slug.indexOf("/"))

export const isWithin = (owners: ReadonlyArray<string> | undefined, slug: string): boolean =>
  owners === undefined || owners.some((owner) => same(owner, ownerOf(slug)))

export const outsideOwners = (
  repos: ReadonlyArray<RepoRef>,
  owners: ReadonlyArray<string> | undefined
): ReadonlyArray<RepoRef> => repos.filter((entry) => !isWithin(owners, entry.slug))
