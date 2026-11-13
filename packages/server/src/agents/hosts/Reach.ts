import { Effect } from "effect"
import { Directory, type DirectoryAgent, reachPane } from "../Directory.ts"
import { type Found, type Run, commandHost, decodeJson, statusOf } from "../Host.ts"

export const reachDirectory = (run: Run) =>
  run({ command: "reach", args: ["ls", "--json"] }).pipe(decodeJson(Directory))

export const reachFound = (agent: DirectoryAgent): Found => ({
  pane: reachPane(agent.address),
  cwd: agent.cwd,
  status: statusOf(agent.status),
  name: agent.address
})

export const reach = commandHost({
  name: "reach",
  title: "reach",
  list: ({ run }) =>
    reachDirectory(run).pipe(
      Effect.map(({ agents }) => agents.filter((agent) => agent.state !== "ended").map(reachFound))
    ),
  steps: ({ id }, text) => [{ command: "reach", args: ["send", id], stdin: text }],
  screen: ({ id }, lines) => ({ command: "reach", args: ["read", id, "--lines", String(lines)] })
})
