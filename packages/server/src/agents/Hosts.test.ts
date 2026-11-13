import { describe, expect, it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { InboxLine, claudeAgents, inboxLine } from "./Claude.ts"
import { type Run, bracketed, bufferName, agentProgramsWith, lastLines, statusOf } from "./Host.ts"
import { enabledHosts, enabledTerminals, terminalHosts } from "./Hosts.ts"
import { cmuxAgent, sidebarFields } from "./hosts/Cmux.ts"
import { herdrFound } from "./hosts/Herdr.ts"
import { appAgents, connectedMachines } from "./hosts/HerdrApp.ts"
import { orcaAgents } from "./hosts/Orca.ts"
import { rexAgent, rexStatus, rexTarget, terminalBlocks } from "./hosts/Rex.ts"
import { screenStatus, tmuxPanes } from "./hosts/Tmux.ts"

const answering =
  (answers: ReadonlyMap<string, string>): Run =>
  (step) => {
    const key = [step.command, ...step.args].join(" ")
    const answer = answers.get(key)

    return answer === undefined ? Effect.fail({ message: `nothing answers ${key}` }) : Effect.succeed(answer)
  }

const agentPrograms = agentProgramsWith(undefined)

const json = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

const call = (block: string, method: string) => `rex block call -s s1 -b ${block} ${method}`

describe("what every host shares", () => {
  it("knows the usual agent programs and takes more from the config", () => {
    expect(agentPrograms.has("claude")).toBe(true)
    expect(agentPrograms.has("zsh")).toBe(false)
    expect(agentProgramsWith(["goose"]).has("goose")).toBe(true)
  })

  it("reads a host's word for what an agent is doing", () => {
    expect(["idle", "done", "working", "busy", "blocked", "asleep", null, undefined].map(statusOf)).toEqual([
      "idle",
      "idle",
      "working",
      "working",
      "blocked",
      "unknown",
      "unknown",
      "unknown"
    ])
  })

  it("keeps the last lines of a screen, pastes as one block and names a paste buffer safely", () => {
    expect(lastLines("a\nb\nc\n\n", 2)).toBe("b\nc")
    expect(bracketed("a\nb")).toBe("\u001b[200~a\nb\u001b[201~")
    expect(bufferName("%3")).toBe("review-desk-3")
  })

  it("asks every host by default, or only the ones the config names", () => {
    expect(enabledHosts(undefined)).toEqual(["herdr", "hc", "cmux", "orca", "rex", "tmux", "claude"])
    expect(enabledHosts(["tmux", "claude"])).toEqual(["tmux", "claude"])
    expect(enabledTerminals(undefined).map((host) => host.kind)).toEqual(["herdr", "hc", "cmux", "orca", "rex", "tmux"])
    expect(enabledTerminals(["claude", "rex"]).map((host) => host.kind)).toEqual(["rex"])
  })
})

describe("the Herdr TUI", () => {
  it.effect("lists agents by name, falling back to the pane, with what each is doing", () =>
    Effect.gen(function* () {
      const listed = {
        result: {
          agents: [
            { agent: "claude", agent_status: "working", cwd: "/w/api", pane_id: "w1:p1", name: "auth" },
            { agent: "codex", agent_status: "done", cwd: "/w/web", pane_id: "w1:p2", name: null },
            { agent: "codex", agent_status: "blocked", cwd: "/w/cli", pane_id: "w1:p3" }
          ]
        }
      }
      const found = yield* terminalHosts.herdr.list(
        answering(new Map([["herdr agent list", json(listed)]])),
        agentPrograms
      )

      expect(found).toEqual([
        { name: "auth", pane: "w1:p1", cwd: "/w/api", status: "working" },
        { name: "w1:p2", pane: "w1:p2", cwd: "/w/web", status: "idle" },
        { name: "w1:p3", pane: "w1:p3", cwd: "/w/cli", status: "blocked" }
      ])
    })
  )

  it("prompts and reads a pane, naming the machine when it is elsewhere", () => {
    expect(terminalHosts.herdr.send("w1:p2", null, "hi")).toEqual([
      { command: "herdr", args: ["agent", "prompt", "w1:p2", "hi"] }
    ])
    expect(terminalHosts.herdr.send("w3:p1", "devbox", "hi")).toEqual([
      { command: "herdr", args: ["--machine", "devbox", "agent", "prompt", "w3:p1", "hi"] }
    ])
    expect(terminalHosts.herdr.read("w3:p1", "devbox", 40)).toEqual({
      command: "herdr",
      args: ["--machine", "devbox", "agent", "read", "w3:p1", "--lines", "40"]
    })
    expect(herdrFound({ agent: "pi", agent_status: "idle", cwd: "/w", pane_id: "w2:p1" }).name).toBe("w2:p1")
  })
})

describe("the Herdr app", () => {
  it("keeps live terminals running an agent, not a parked one, with what each is doing", () => {
    expect(
      appAgents([
        { address: "t11", agent: "claude-code", cwd: "/w/api", state: "live", status: "working" },
        { address: "t1", agent: "codex", cwd: "/w/web", state: "live", status: "idle" },
        { address: "t12", agent: "codex", cwd: "/w/web", state: "live", status: "blocked" },
        { address: "t7", agent: "claude-asleep", cwd: "/w/web", state: "live", status: "idle" },
        { address: "t2", agent: "", cwd: "/w/shell", state: "live", status: "idle" },
        { address: "t3", agent: null, cwd: "/w/shell", state: "live", status: null },
        { address: "t6", agent: "codex", cwd: "/w/x" },
        { address: "t4", agent: "codex", cwd: "/w/old", state: "finished", status: "done" },
        { address: "t5", agent: "codex", cwd: null, state: "live", status: "idle" },
        { address: "devbox/t8", agent: "codex", cwd: "/w/remote", state: "live", status: "idle" }
      ])
    ).toEqual([
      { pane: "hc:t11", cwd: "/w/api", status: "working" },
      { pane: "hc:t1", cwd: "/w/web", status: "idle" },
      { pane: "hc:t12", cwd: "/w/web", status: "blocked" }
    ])
  })

  it("names a terminal by its app name, qualifies another machine's address and leaves out machines linked beyond it", () => {
    expect(
      appAgents(
        [
          { address: "t2b", name: "ui-kit", agent: "claude-code", cwd: "/w/ui", state: "live", status: "idle" },
          { address: "t9", name: null, agent: "codex", cwd: "/w/api", state: "live", status: "done" },
          { address: "mac-mini/t9", agent: "codex", cwd: "/w/api", state: "live", status: "idle" }
        ],
        "devbox"
      )
    ).toEqual([
      { pane: "hc:devbox/t2b", cwd: "/w/ui", status: "idle", name: "ui-kit" },
      { pane: "hc:devbox/t9", cwd: "/w/api", status: "idle" }
    ])
    expect(
      connectedMachines([
        { name: "devbox", state: "connected" },
        { name: "laptop", state: "disconnected" }
      ])
    ).toEqual(["devbox"])
  })

  it.effect("lists, sends and reads with hc", () =>
    Effect.gen(function* () {
      const listed = { terminals: [{ address: "t3", agent: "pi", cwd: "/w", state: "live", status: "idle" }] }
      const found = yield* terminalHosts.hc.list(answering(new Map([["hc ls --json", json(listed)]])), agentPrograms)

      expect(found).toEqual([{ pane: "hc:t3", cwd: "/w", status: "idle" }])
      expect(terminalHosts.hc.send("devbox/t2b", "devbox", "hi")).toEqual([
        { command: "hc", args: ["send", "devbox/t2b", "hi"] }
      ])
      expect(terminalHosts.hc.read("t3", null, 20)).toEqual({ command: "hc", args: ["read", "t3", "--lines", "20"] })
    })
  )
})

describe("cmux", () => {
  it("reads a workspace's sidebar for the agent, where it works and what it is doing", () => {
    expect(cmuxAgent("ws-1", sidebarFields("claude_code=Running tool\nfocused_cwd=/w/api\nnot a field\n=x"))).toEqual([
      { pane: "cmux:ws-1", cwd: "/w/api", status: "working" }
    ])
    expect(cmuxAgent("ws-2", sidebarFields("codex=Idle\ncwd=/w/web"))).toEqual([
      { pane: "cmux:ws-2", cwd: "/w/web", status: "idle" }
    ])
    expect(cmuxAgent("ws-3", sidebarFields("gemini=Needs input\ncwd=/w/x"))).toEqual([
      { pane: "cmux:ws-3", cwd: "/w/x", status: "blocked" }
    ])
    expect(cmuxAgent("ws-4", sidebarFields("cwd=/w/shell"))).toEqual([])
    expect(cmuxAgent("ws-5", sidebarFields("codex=Idle"))).toEqual([])
  })

  it.effect("lists every workspace, pastes as one block, presses enter and reads the screen", () =>
    Effect.gen(function* () {
      const run = answering(
        new Map([
          ["cmux --json --id-format uuids list-workspaces", json({ workspaces: [{ id: "a" }, { id: "b" }] })],
          ["cmux sidebar-state --workspace a", "claude_code=Idle\ncwd=/w/a"],
          ["cmux sidebar-state --workspace b", "cwd=/w/b"]
        ])
      )

      const found = yield* terminalHosts.cmux.list(run, agentPrograms)

      expect(found).toEqual([{ pane: "cmux:a", cwd: "/w/a", status: "idle" }])
      expect(terminalHosts.cmux.send("ws-1", null, "a\nb")).toEqual([
        { command: "cmux", args: ["set-buffer", "--name", "review-desk-ws1", "\u001b[200~a\nb\u001b[201~"] },
        { command: "cmux", args: ["paste-buffer", "--name", "review-desk-ws1", "--workspace", "ws-1"] },
        { command: "cmux", args: ["send-key", "--workspace", "ws-1", "enter"] }
      ])
      expect(terminalHosts.cmux.read("ws-1", null, 40)).toEqual({
        command: "cmux",
        args: ["read-screen", "--workspace", "ws-1"]
      })
    })
  )
})

describe("Orca", () => {
  it("keeps terminals that run a connected, writable agent", () => {
    const terminal = { handle: "o1", worktreePath: "/w/api", connected: true, writable: true, agentIdentity: "claude" }

    expect(
      orcaAgents([
        terminal,
        { ...terminal, handle: "o2", connected: false },
        { ...terminal, handle: "o3", writable: false },
        { handle: "o4", worktreePath: "/w/x", connected: true, writable: true }
      ])
    ).toEqual([{ pane: "orca:o1", cwd: "/w/api", status: "unknown" }])
  })

  it.effect("lists, sends with enter and reads the rendered screen with its CLI", () =>
    Effect.gen(function* () {
      const listed = {
        result: {
          terminals: [{ handle: "o1", worktreePath: "/w", connected: true, writable: true, agentIdentity: "codex" }]
        }
      }
      const run = answering(new Map([["orca terminal list --json", json(listed)]]))

      const found = yield* terminalHosts.orca.list(run, agentPrograms)

      expect(found).toEqual([{ pane: "orca:o1", cwd: "/w", status: "unknown" }])
      expect(terminalHosts.orca.send("o1", null, "hi")).toEqual([
        { command: "orca", args: ["terminal", "send", "--terminal", "o1", "--text", "hi", "--enter"] }
      ])
      expect(terminalHosts.orca.read("o1", null, 40)).toEqual({
        command: "orca",
        args: ["terminal", "read", "--terminal", "o1", "--screen"]
      })
    })
  )
})

describe("tmux", () => {
  it("keeps panes running a known agent program", () => {
    expect(tmuxPanes("%1\t/w/api\tclaude\n%2\t/w/web\tzsh\n\n%3\t/w/cli\tcodex", agentPrograms)).toEqual([
      { id: "%1", cwd: "/w/api" },
      { id: "%3", cwd: "/w/cli" }
    ])
  })

  it("tells from the bottom of the screen whether the agent is asking, working or waiting", () => {
    expect(screenStatus("old: esc to interrupt\n".repeat(1) + "\n".repeat(20) + "> ")).toBe("idle")
    expect(screenStatus("Bash(rm -rf build)\n Do you want to proceed?\n ❯ 1. Yes")).toBe("blocked")
    expect(screenStatus("✻ Thinking… (12s · esc to interrupt)")).toBe("working")
    expect(screenStatus("• Working (3s • Esc to interrupt)")).toBe("working")
    expect(screenStatus("> ")).toBe("idle")
  })

  it.effect("lists agent panes with what each is doing, unknown when the screen cannot be read", () =>
    Effect.gen(function* () {
      const run = answering(
        new Map([
          [
            "tmux list-panes -a -F #{pane_id}\t#{pane_current_path}\t#{pane_current_command}",
            "%1\t/w/api\tclaude\n%2\t/w/web\tcodex\n%3\t/w/x\tzsh"
          ],
          ["tmux capture-pane -p -t %1", "esc to interrupt"]
        ])
      )

      const found = yield* terminalHosts.tmux.list(run, agentPrograms)

      expect(found).toEqual([
        { pane: "tmux:%1", cwd: "/w/api", status: "working" },
        { pane: "tmux:%2", cwd: "/w/web", status: "unknown" }
      ])
    })
  )

  it("pastes as one block from stdin, presses enter and reads recent lines", () => {
    expect(terminalHosts.tmux.send("%3", null, "a\nb")).toEqual([
      { command: "tmux", args: ["load-buffer", "-b", "review-desk-3", "-"], stdin: "a\nb" },
      { command: "tmux", args: ["paste-buffer", "-p", "-d", "-b", "review-desk-3", "-t", "%3"] },
      { command: "tmux", args: ["send-keys", "-t", "%3", "Enter"] }
    ])
    expect(terminalHosts.tmux.read("%3", null, 40)).toEqual({
      command: "tmux",
      args: ["capture-pane", "-p", "-t", "%3", "-S", "-40"]
    })
  })
})

describe("Rex", () => {
  const where = { session: "session:01", block: "block:02", label: null }

  it("keeps terminal blocks with their labels", () => {
    expect(
      terminalBlocks("s", [
        { block_id: "b1", flavor: "terminal", label: "api" },
        { block_id: "b2", flavor: "terminal" },
        { block_id: "b3", flavor: "terminal", label: null },
        { block_id: "b4", flavor: "browser" }
      ])
    ).toEqual([
      { session: "s", block: "b1", label: "api" },
      { session: "s", block: "b2", label: null },
      { session: "s", block: "b3", label: null }
    ])
  })

  it("takes a block whose program is an agent, from the foreground or the child, where that program works", () => {
    expect(rexAgent(where, { foreground: { argv0: "/opt/bin/claude", cwd: "/w/api" } }, "idle", agentPrograms)).toEqual(
      [{ pane: "rex:session:01/block:02", cwd: "/w/api", status: "idle" }]
    )
    expect(
      rexAgent(
        { ...where, label: "auth" },
        { foreground: { argv0: "zsh", cwd: "/w" }, child: { argv0: "codex", cwd: "/w/cli" } },
        "working",
        agentPrograms
      )
    ).toEqual([{ pane: "rex:session:01/block:02", cwd: "/w/cli", status: "working", name: "auth" }])
    expect(rexAgent(where, { foreground: { argv0: "zsh", cwd: "/w" } }, "idle", agentPrograms)).toEqual([])
    expect(rexAgent(where, { foreground: { cwd: "/w" }, child: null }, "idle", agentPrograms)).toEqual([])
    expect(rexAgent(where, { foreground: { argv0: "claude" } }, "idle", agentPrograms)).toEqual([])
  })

  it("reads what the program reported through the Program Status Protocol", () => {
    expect(rexStatus({})).toBe("unknown")
    expect(rexStatus({ records: [{ state: "working", id: "build" }] })).toBe("unknown")
    expect(rexStatus({ records: [{ state: "working" }] })).toBe("working")
    expect(rexStatus({ records: [{ state: "idle" }, { state: "blocked", id: null }] })).toBe("blocked")
    expect(rexStatus({ records: [{ state: "done" }] })).toBe("idle")
  })

  it("addresses a block in its session, or by its id alone", () => {
    expect(rexTarget("session:01/block:02")).toEqual({ session: "session:01", block: "block:02" })
    expect(rexTarget("block:02")).toEqual({ session: "", block: "block:02" })
    expect(terminalHosts.rex.read("block:02", null, 40)).toEqual({
      command: "rex",
      args: ["capture", "-b", "block:02", "--trim", "--unwrap"]
    })
  })

  it("pastes as one block from stdin and presses enter", () => {
    expect(terminalHosts.rex.send("session:01/block:02", null, "a\nb")).toEqual([
      { command: "rex", args: ["send", "-s", "session:01", "-b", "block:02"], stdin: "\u001b[200~a\nb\u001b[201~" },
      { command: "rex", args: ["send-key", "-s", "session:01", "-b", "block:02", "enter"] }
    ])
  })

  it.effect("lists agents across sessions without starting a server, skipping blocks it cannot read", () =>
    Effect.gen(function* () {
      const run = answering(
        new Map([
          ["rex --autostart=false ls --json", json({ sessions: [{ session_id: "s1" }] })],
          [
            "rex block ls -s s1 --json",
            json({
              blocks: [
                { block_id: "b1", flavor: "terminal" },
                { block_id: "b2", flavor: "terminal" },
                { block_id: "b3", flavor: "terminal" },
                { block_id: "b4", flavor: "terminal" }
              ]
            })
          ],
          [call("b1", "process"), json({ foreground: { argv0: "claude", cwd: "/w/api" } })],
          [call("b1", "program_status"), json({ records: [{ state: "working" }] })],
          [call("b2", "process"), json({ foreground: { argv0: "codex", cwd: "/w/cli" } })],
          [call("b3", "process"), json({ foreground: { argv0: "zsh", cwd: "/w" } })]
        ])
      )

      const found = yield* terminalHosts.rex.list(run, agentPrograms)

      expect(found).toEqual([
        { pane: "rex:s1/b1", cwd: "/w/api", status: "working" },
        { pane: "rex:s1/b2", cwd: "/w/cli", status: "unknown" }
      ])
    })
  )
})

describe("Claude Code sessions with no terminal of their own", () => {
  it("adds sessions that can take a message and are not already a terminal agent", () => {
    const sessions = [
      { sessionId: "s1", cwd: "/w/api", status: "busy", messagingSocketPath: "/s/1" },
      { sessionId: "s2", cwd: "/w/web", status: "idle", messagingSocketPath: "/s/2" },
      { sessionId: "s3", cwd: "/w/cli" },
      { sessionId: "s4", cwd: "/w/docs", messagingSocketPath: "/s/4" }
    ]

    expect(claudeAgents(sessions, [{ pane: "w1:p1", cwd: "/w/web", status: "idle" }])).toEqual([
      { pane: "claude:s1", cwd: "/w/api", status: "working" },
      { pane: "claude:s4", cwd: "/w/docs", status: "unknown" }
    ])
  })

  it("writes a message as one user line for the session's inbox", () => {
    expect(Schema.decodeSync(Schema.fromJsonString(InboxLine))(inboxLine("hello"))).toEqual({
      type: "user",
      message: { role: "user", content: "hello" }
    })
    expect(inboxLine("x").endsWith("\n")).toBe(true)
  })
})
