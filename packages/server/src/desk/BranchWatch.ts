import type { Login } from "@review-desk/contract/Ids.ts"
import { RepoSlug, type Text } from "@review-desk/contract/Ids.ts"
import type { BranchChange } from "@review-desk/domain/Branches.ts"
import type { PullFacts } from "@review-desk/domain/Facts.ts"
import { isTrustedRepo } from "@review-desk/domain/Trust.ts"
import { Option } from "effect"
import type { LiveAgent } from "../agents/Agents.ts"
import type { AgentTarget } from "../agents/Remote.ts"
import type { DeskSettings } from "../config/DeskConfig.ts"

export type BranchSettings = Pick<DeskSettings, "desk" | "aliases" | "owner" | "repos">

export type Watched = {
  readonly key: string
  readonly repo: RepoSlug
  readonly branch: string
  readonly agents: ReadonlyArray<AgentTarget>
}

export type Reported = BranchChange & { readonly jobs: ReadonlyArray<Text> }

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const repoOfRemote = (remote: string, host: string): RepoSlug | null => {
  const found = new RegExp(
    `^(?:[a-z+]+://)?(?:[^@/]+@)?${escaped(host)}(?::\\d+/|:|/)([^/]+/[^/]+?)(?:\\.git)?/?$`
  ).exec(remote)

  return found?.[1] === undefined ? null : RepoSlug.make(found[1])
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const isMine = (settings: BranchSettings, repo: RepoSlug): boolean =>
  [settings.desk, ...settings.aliases].some((login: Login) => same(login, repo.slice(0, repo.indexOf("/"))))

const trusted = (settings: BranchSettings, repo: RepoSlug): boolean =>
  isMine(settings, repo) || isTrustedRepo(settings, "gitea", repo)

const hasOpenPull = (facts: ReadonlyArray<PullFacts>, repo: RepoSlug, branch: string): boolean =>
  facts.some((pull) => pull.forge === "gitea" && pull.state === "open" && same(pull.repo, repo) && pull.head === branch)

type Located = { readonly agent: AgentTarget; readonly repo: RepoSlug; readonly branch: string }

const keyOf = (entry: Located): string => `${entry.repo}@${entry.branch}`

const locate = (settings: BranchSettings, host: string, agent: LiveAgent): ReadonlyArray<Located> => {
  const branch = Option.getOrElse(agent.branch, () => "")
  const repo = repoOfRemote(
    Option.getOrElse(agent.remote, () => ""),
    host
  )
  if (repo === null || branch === "" || branch === "HEAD") return []

  return trusted(settings, repo) ? [{ agent: { machine: agent.machine, pane: agent.pane }, repo, branch }] : []
}

export const watchedBranches = (
  settings: BranchSettings,
  host: string,
  facts: ReadonlyArray<PullFacts>,
  agents: ReadonlyArray<LiveAgent>
): ReadonlyArray<Watched> => {
  const located = agents
    .flatMap((agent) => locate(settings, host, agent))
    .filter((entry) => !hasOpenPull(facts, entry.repo, entry.branch))

  return located
    .filter((entry, index) => located.findIndex((other) => keyOf(other) === keyOf(entry)) === index)
    .map((first) => ({
      key: keyOf(first),
      repo: first.repo,
      branch: first.branch,
      agents: located.filter((entry) => keyOf(entry) === keyOf(first)).map((entry) => entry.agent)
    }))
}

const jobsText = (jobs: ReadonlyArray<Text>): string => (jobs.length === 0 ? "" : `, failed jobs: ${jobs.join(", ")}`)

const changeLine = (change: Reported): string =>
  change.kind === "failed"
    ? `- ${change.run.workflow} failed: "${change.run.title}"${jobsText(change.jobs)} (${change.run.url})`
    : `- ${change.run.workflow} passes again (${change.run.url})`

export const branchMessage = (
  where: { readonly repo: RepoSlug; readonly branch: string },
  changes: ReadonlyArray<Reported>,
  owner: string
): string =>
  [
    `[review-desk] ${where.repo} branch ${where.branch} has CI updates:`,
    ...changes.map(changeLine),
    ...(changes.some((change) => change.kind === "failed")
      ? [
          `Read the failed job's log, fix the cause in the repository and push. If the cause is the runner or CI infrastructure rather than the repository, tell ${owner} instead of working around it.`
        ]
      : [])
  ].join("\n")
