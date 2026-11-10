import { describe, expect, it } from "@effect/vitest"
import {
  appAgents,
  bracketed,
  claudeAgents,
  cmuxAgent,
  inboxLine,
  orcaAgents,
  sidebarFields,
  tmuxAgents
} from "./Terminals.ts"

describe("agents in the Herdr app", () => {
  it("keeps live terminals running an agent, not a parked one, addressed for hc, and marks the working ones", () => {
    expect(
      appAgents([
        { address: "t11", agent: "claude-code", cwd: "/w/api", state: "live", status: "working" },
        { address: "t1", agent: "codex", cwd: "/w/web", state: "live", status: "idle" },
        { address: "t7", agent: "claude-asleep", cwd: "/w/web", state: "live", status: "idle" },
        { address: "t2", agent: "", cwd: "/w/shell", state: "live", status: "idle" },
        { address: "t3", agent: null, cwd: "/w/shell", state: "live", status: null },
        { address: "t6", agent: "codex", cwd: "/w/x" },
        { address: "t4", agent: "codex", cwd: "/w/old", state: "finished", status: "done" },
        { address: "t5", agent: "codex", cwd: null, state: "live" }
      ])
    ).toEqual([
      { pane: "hc:t11", cwd: "/w/api", working: true },
      { pane: "hc:t1", cwd: "/w/web", working: false }
    ])
  })
})

describe("agents in cmux, Orca and tmux", () => {
  it("reads a cmux workspace's sidebar for the agent and where it works", () => {
    const sidebar = sidebarFields("claude_code=Running tool\nfocused_cwd=/w/api\nnot a field\n=x")

    expect(cmuxAgent("ws-1", sidebar)).toEqual([{ pane: "cmux:ws-1", cwd: "/w/api", working: true }])
    expect(cmuxAgent("ws-2", sidebarFields("codex=Idle\ncwd=/w/web"))).toEqual([
      { pane: "cmux:ws-2", cwd: "/w/web", working: false }
    ])
    expect(cmuxAgent("ws-3", sidebarFields("cwd=/w/shell"))).toEqual([])
  })

  it("keeps Orca terminals that run a connected, writable agent", () => {
    const terminal = { handle: "o1", worktreePath: "/w/api", connected: true, writable: true, agentIdentity: "claude" }

    expect(
      orcaAgents([
        terminal,
        { ...terminal, handle: "o2", connected: false },
        { ...terminal, handle: "o3", writable: false },
        { handle: "o4", worktreePath: "/w/x", connected: true, writable: true }
      ])
    ).toEqual([{ pane: "orca:o1", cwd: "/w/api", working: false }])
  })

  it("keeps tmux panes running a known agent command", () => {
    expect(tmuxAgents("%1\t/w/api\tclaude\n%2\t/w/web\tzsh\n\n%3\t/w/cli\tcodex")).toEqual([
      { pane: "tmux:%1", cwd: "/w/api", working: false },
      { pane: "tmux:%3", cwd: "/w/cli", working: false }
    ])
  })

  it("pastes as one bracketed block so a long message is not run line by line", () => {
    expect(bracketed("a\nb")).toBe("\u001b[200~a\nb\u001b[201~")
  })
})

describe("Claude Code sessions with no terminal of their own", () => {
  it("adds sessions that can take a message and are not already a terminal agent", () => {
    const sessions = [
      { sessionId: "s1", cwd: "/w/api", status: "busy", messagingSocketPath: "/s/1" },
      { sessionId: "s2", cwd: "/w/web", status: "idle", messagingSocketPath: "/s/2" },
      { sessionId: "s3", cwd: "/w/cli" },
      { sessionId: "s4", cwd: "/w/docs", status: "working", messagingSocketPath: "/s/4" }
    ]

    expect(claudeAgents(sessions, [{ pane: "w1:p1", cwd: "/w/web", working: false }])).toEqual([
      { pane: "claude:s1", cwd: "/w/api", working: true },
      { pane: "claude:s4", cwd: "/w/docs", working: true }
    ])
  })

  it("writes a message as one user line for the session's inbox", () => {
    expect(JSON.parse(inboxLine("hello"))).toEqual({ type: "user", message: { role: "user", content: "hello" } })
    expect(inboxLine("x").endsWith("\n")).toBe(true)
  })
})
