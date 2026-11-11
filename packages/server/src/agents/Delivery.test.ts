import { describe, expect, it } from "@effect/vitest"
import { type Delivery, deliveryFor } from "./Delivery.ts"

const local = (pane: string) => ({ machine: null, pane })

const programs = (delivery: Delivery): ReadonlyArray<string> =>
  delivery._tag === "Inbox" ? ["inbox"] : delivery.steps.map((step) => step.command)

describe("how a message reaches each kind of terminal", () => {
  it("hands a Claude Code session the message through its inbox, never through herdr", () => {
    expect(deliveryFor(local("claude:c581536c-dfed-4822-a7f3-3b43dc8020fa"), "hi")).toEqual({
      _tag: "Inbox",
      session: "c581536c-dfed-4822-a7f3-3b43dc8020fa"
    })
    expect(deliveryFor({ machine: "devbox", pane: "claude:abc" }, "hi")).toEqual({ _tag: "Inbox", session: "abc" })
  })

  it("sends to a Herdr app terminal with hc, on this machine or a linked one", () => {
    expect(deliveryFor(local("hc:t11"), "hi")).toEqual({
      _tag: "Commands",
      steps: [{ command: "hc", args: ["send", "t11", "hi"] }]
    })
    expect(deliveryFor({ machine: "devbox", pane: "hc:devbox/t2b" }, "hi")).toEqual({
      _tag: "Commands",
      steps: [{ command: "hc", args: ["send", "devbox/t2b", "hi"] }]
    })
  })

  it("prompts a Herdr TUI pane with herdr, naming the machine when it is elsewhere", () => {
    expect(deliveryFor(local("w1:p2"), "hi")).toEqual({
      _tag: "Commands",
      steps: [{ command: "herdr", args: ["agent", "prompt", "w1:p2", "hi"] }]
    })
    expect(deliveryFor({ machine: "devbox", pane: "w3:p1" }, "hi")).toEqual({
      _tag: "Commands",
      steps: [{ command: "herdr", args: ["--machine", "devbox", "agent", "prompt", "w3:p1", "hi"] }]
    })
  })

  it("pastes into cmux and tmux as one block and presses enter, and sends to Orca with its CLI", () => {
    expect(programs(deliveryFor(local("cmux:ws-1"), "a\nb"))).toEqual(["cmux", "cmux", "cmux"])
    expect(deliveryFor(local("cmux:ws-1"), "a\nb")).toMatchObject({
      steps: [{ args: ["set-buffer", "--name", "review-desk-ws1", "\u001b[200~a\nb\u001b[201~"] }, {}, {}]
    })
    expect(deliveryFor(local("tmux:%3"), "a\nb")).toMatchObject({
      steps: [
        { command: "tmux", stdin: "a\nb" },
        { args: ["paste-buffer", "-p", "-d", "-b", "review-desk-3", "-t", "%3"] },
        {}
      ]
    })
    expect(programs(deliveryFor(local("orca:o1"), "hi"))).toEqual(["orca"])
  })

  it("uses herdr only for an address with no other host's prefix", () => {
    const others = ["claude:s", "hc:t1", "cmux:w", "orca:o", "tmux:%1"]

    expect(others.flatMap((pane) => programs(deliveryFor(local(pane), "x"))).includes("herdr")).toBe(false)
  })
})
