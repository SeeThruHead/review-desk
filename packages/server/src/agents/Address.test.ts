import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { addressText, callerAddress, parseAddress } from "./Address.ts"

const none = {
  herdrPane: Option.none(),
  appTerminal: Option.none(),
  cmuxWorkspace: Option.none(),
  orcaTerminal: Option.none(),
  tmuxPane: Option.none(),
  claudeSession: Option.none()
}

describe("where a message for an agent goes", () => {
  it("reads a Herdr pane as it is and every other host by its prefix", () => {
    expect(parseAddress("w1:p2")).toEqual({ host: "herdr", id: "w1:p2" })
    expect(parseAddress("hc:t11")).toEqual({ host: "hc", id: "t11" })
    expect(parseAddress("tmux:%3")).toEqual({ host: "tmux", id: "%3" })
    expect(parseAddress("claude:5f1c")).toEqual({ host: "claude", id: "5f1c" })
  })

  it("writes an address back the way it was read", () => {
    expect(addressText(parseAddress("w1:p2"))).toBe("w1:p2")
    expect(addressText(parseAddress("cmux:ab-12"))).toBe("cmux:ab-12")
  })

  it("takes the caller's own terminal, preferring the Herdr TUI, then the app, then the others", () => {
    expect(callerAddress({ ...none, herdrPane: Option.some("w1:p2"), appTerminal: Option.some("t4") })).toEqual(
      Option.some("w1:p2")
    )
    expect(callerAddress({ ...none, appTerminal: Option.some("t11"), tmuxPane: Option.some("%1") })).toEqual(
      Option.some("hc:t11")
    )
    expect(callerAddress({ ...none, cmuxWorkspace: Option.some("ws") })).toEqual(Option.some("cmux:ws"))
    expect(callerAddress({ ...none, orcaTerminal: Option.some("o1") })).toEqual(Option.some("orca:o1"))
    expect(callerAddress({ ...none, tmuxPane: Option.some("%7") })).toEqual(Option.some("tmux:%7"))
    expect(callerAddress({ ...none, claudeSession: Option.some("abc") })).toEqual(Option.some("claude:abc"))
    expect(callerAddress(none)).toEqual(Option.none())
  })
})
