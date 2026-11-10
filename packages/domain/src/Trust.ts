import type { Forge, Login, RepoSlug } from "@review-desk/contract/Ids.ts"

export type TrustRules = {
  readonly repos: ReadonlyArray<{ readonly forge: Forge; readonly slug: RepoSlug }>
  readonly people: ReadonlyArray<Login>
}

export const isTrustedRepo = (rules: Pick<TrustRules, "repos">, forge: Forge, repo: RepoSlug): boolean =>
  rules.repos.some((entry) => entry.forge === forge && entry.slug.toLowerCase() === repo.toLowerCase())

export const isTrustedPerson = (rules: TrustRules, login: Login): boolean =>
  rules.people.some((person) => person.toLowerCase() === login.toLowerCase())

export const mayReachAgent = (
  rules: TrustRules,
  where: { readonly forge: Forge; readonly repo: RepoSlug },
  from: Login
): boolean => isTrustedRepo(rules, where.forge, where.repo) && isTrustedPerson(rules, from)
