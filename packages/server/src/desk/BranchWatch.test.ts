import { describe, expect, it } from "@effect/vitest"
import { Login, RepoSlug, SessionName, Text, Url } from "@review-desk/contract/Ids.ts"
import { Branch } from "@review-desk/domain/Facts.ts"
import { pull } from "@review-desk/domain/Facts.testing.ts"
import { Option } from "effect"
import type { LiveAgent } from "../agents/Agents.ts"
import { branchMessage, repoOfRemote, watchedBranches } from "./BranchWatch.ts"

const settings = {
  desk: Login.make("dana"),
  aliases: [Login.make("you")],
  owner: "Dana",
  repos: [{ forge: "gitea" as const, slug: RepoSlug.make("friends/shared") }]
}

const host = "gitea.example"

const agent = (name: string, remote: string, branch: string): LiveAgent => ({
  name: SessionName.make(name),
  machine: name === "infra-2" ? "devbox" : null,
  pane: `w1:${name}`,
  cwd: `/work/${name}`,
  working: false,
  branch: Option.some(branch),
  remote: Option.some(remote)
})

describe("which repository a checkout's remote points at", () => {
  it("reads ssh, scp-style and https remotes on the Gitea host", () => {
    expect(repoOfRemote("ssh://git@gitea.example:2223/you/infra.git", host)).toBe("you/infra")
    expect(repoOfRemote("git@gitea.example:you/app.git", host)).toBe("you/app")
    expect(repoOfRemote("https://gitea.example/you/server", host)).toBe("you/server")
  })

  it("ignores remotes on other hosts and ones it cannot read", () => {
    expect(repoOfRemote("git@github.com:you/infra.git", host)).toBeNull()
    expect(repoOfRemote("ssh://git@gitea.example.evil.com/you/infra.git", host)).toBeNull()
    expect(repoOfRemote("gitea.example", host)).toBeNull()
  })
})

describe("which branches get CI updates", () => {
  it("watches the branch each agent is on in a repository the desk's owner owns or trusts, once per branch", () => {
    const watched = watchedBranches(
      settings,
      host,
      [],
      [
        agent("infra", "ssh://git@gitea.example:2223/you/infra.git", "main"),
        agent("infra-2", "git@gitea.example:you/infra.git", "main"),
        agent("shared", "git@gitea.example:friends/shared.git", "fix-it")
      ]
    )

    expect(watched).toEqual([
      {
        key: "you/infra@main",
        repo: "you/infra",
        branch: "main",
        agents: [
          { machine: null, pane: "w1:infra" },
          { machine: "devbox", pane: "w1:infra-2" }
        ]
      },
      {
        key: "friends/shared@fix-it",
        repo: "friends/shared",
        branch: "fix-it",
        agents: [{ machine: null, pane: "w1:shared" }]
      }
    ])
  })

  it("leaves out strangers' repositories, other hosts, detached checkouts and branches with an open pull request", () => {
    const open = {
      ...pull(4, {}),
      forge: "gitea" as const,
      repo: RepoSlug.make("you/infra"),
      head: Branch.make("feature")
    }
    const watched = watchedBranches(
      settings,
      host,
      [open],
      [
        agent("stranger", "git@gitea.example:someone/else.git", "main"),
        agent("github", "git@github.com:you/infra.git", "main"),
        agent("detached", "git@gitea.example:you/infra.git", "HEAD"),
        agent("feature", "git@gitea.example:you/infra.git", "feature"),
        { ...agent("no-remote", "", "main"), remote: Option.none() },
        { ...agent("no-branch", "git@gitea.example:you/infra.git", ""), branch: Option.none() }
      ]
    )

    expect(watched).toEqual([])
  })

  it("watches a branch again once its pull request is merged", () => {
    const merged = {
      ...pull(4, {}),
      forge: "gitea" as const,
      repo: RepoSlug.make("you/infra"),
      head: Branch.make("feature"),
      state: "merged" as const
    }

    expect(
      watchedBranches(settings, host, [merged], [agent("feature", "git@gitea.example:you/infra.git", "feature")])
    ).toHaveLength(1)
  })
})

const run = (id: number, workflow: string) => ({
  id,
  workflow: Text.make(workflow),
  title: Text.make("Bump the image"),
  url: Url.make(`https://gitea.example/you/infra/actions/runs/${id}`),
  done: true,
  outcome: "failed" as const
})

describe("the CI message an agent gets", () => {
  it("names the failed workflow, its failed jobs and the run, and a workflow passing again", () => {
    const message = branchMessage(
      { repo: RepoSlug.make("you/infra"), branch: "main" },
      [
        { kind: "failed", run: run(12, "ci.yml"), jobs: [Text.make("lint"), Text.make("test")] },
        { kind: "fixed", run: { ...run(13, "deploy.yml"), outcome: "passed" }, jobs: [] }
      ],
      "Dana"
    )

    expect(message).toContain("[review-desk] you/infra branch main has CI updates:")
    expect(message).toContain(
      '- ci.yml failed: "Bump the image", failed jobs: lint, test (https://gitea.example/you/infra/actions/runs/12)'
    )
    expect(message).toContain("- deploy.yml passes again (https://gitea.example/you/infra/actions/runs/13)")
    expect(message).toContain("Read the failed job's log, fix the cause in the repository and push.")
    expect(message).toContain("tell Dana instead of working around it")
  })

  it("leaves out the job list when Gitea named no failed job, and the fix advice when nothing failed", () => {
    expect(
      branchMessage(
        { repo: RepoSlug.make("you/infra"), branch: "main" },
        [{ kind: "failed", run: run(12, "ci.yml"), jobs: [] }],
        "Dana"
      )
    ).toContain('- ci.yml failed: "Bump the image" (https')
    expect(
      branchMessage(
        { repo: RepoSlug.make("you/infra"), branch: "main" },
        [{ kind: "fixed", run: run(13, "deploy.yml"), jobs: [] }],
        "Dana"
      )
    ).not.toContain("Read the failed job's log")
  })
})
