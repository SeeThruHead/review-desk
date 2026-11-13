import { Effect, Schema } from "effect"
import { type Found, type Run, type Status, commandHost, bracketed, bufferName, decodeJson } from "../Host.ts"

export const CmuxWorkspaces = Schema.Struct({ workspaces: Schema.Array(Schema.Struct({ id: Schema.String })) })

const sidebarAgents = ["claude_code", "codex", "opencode", "gemini"] as const

export const sidebarFields = (text: string): ReadonlyMap<string, string> =>
  new Map(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.indexOf("=") > 0)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)] as const)
  )

const sidebarStatus = (value: string): Status => {
  const state = value.split(" ")[0]
  if (state === "Running") return "working"
  if (state === "Idle") return "idle"

  return "blocked"
}

export const cmuxAgent = (workspace: string, sidebar: ReadonlyMap<string, string>): ReadonlyArray<Found> => {
  const state = sidebarAgents.map((key) => sidebar.get(key)).find((value) => value !== undefined)
  const cwd = sidebar.get("focused_cwd") ?? sidebar.get("cwd")
  if (state === undefined || cwd === undefined) return []

  return [{ pane: `cmux:${workspace}`, cwd, status: sidebarStatus(state) }]
}

const workspaceAgents = (run: Run, id: string) =>
  run({ command: "cmux", args: ["sidebar-state", "--workspace", id] }).pipe(
    Effect.map((text) => cmuxAgent(id, sidebarFields(text)))
  )

export const cmux = commandHost({
  name: "cmux",
  title: "cmux",
  list: ({ run }) =>
    run({ command: "cmux", args: ["--json", "--id-format", "uuids", "list-workspaces"] }).pipe(
      decodeJson(CmuxWorkspaces),
      Effect.flatMap(({ workspaces }) =>
        Effect.forEach(workspaces, (workspace) => workspaceAgents(run, workspace.id), { concurrency: 4 })
      ),
      Effect.map((found) => found.flat())
    ),
  steps: ({ id }, text) => [
    { command: "cmux", args: ["set-buffer", "--name", bufferName(id), bracketed(text)] },
    { command: "cmux", args: ["paste-buffer", "--name", bufferName(id), "--workspace", id] },
    { command: "cmux", args: ["send-key", "--workspace", id, "enter"] }
  ],
  screen: ({ id }) => ({ command: "cmux", args: ["read-screen", "--workspace", id] })
})
