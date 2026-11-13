import { describe, expect, it } from "@effect/vitest"
import {
  type DirectoryAgent,
  addressesIn,
  directed,
  isAgentAddress,
  pickAgent,
  targetFor,
  unavailable
} from "./Directory.ts"

const entry = (address: string, fields: Partial<DirectoryAgent> = {}): DirectoryAgent => ({
  address,
  state: "live",
  status: "idle",
  host: "herdr-app",
  id: "t1",
  cwd: "/code/api",
  ...fields
})

describe("agent addresses", () => {
  it("are machine/space/name, never a pane id or a host address", () => {
    expect(isAgentAddress("sthdev/homelab/homelab")).toBe(true)
    expect(isAgentAddress("homelab")).toBe(false)
    expect(isAgentAddress("sthdev/t5")).toBe(false)
    expect(isAgentAddress("rex:s/b/c")).toBe(false)
    expect(isAgentAddress("a/b /c")).toBe(false)
  })

  it("collects each address once from areas and claims, leaving names out", () => {
    expect(addressesIn(["mac-mini/api/api", "auth", "mac-mini/api/api", "sthdev/ui/ui"])).toEqual([
      "mac-mini/api/api",
      "sthdev/ui/ui"
    ])
  })
})

describe("looking addresses up in reach's directory", () => {
  it("finds the one running agent at an address, asleep or live", () => {
    const asleep = entry("sthdev/ui/ui", { state: "asleep" })
    const found = directed(["mac-mini/api/api", "sthdev/ui/ui"], [entry("mac-mini/api/api"), asleep])
    expect(found.found).toEqual([entry("mac-mini/api/api"), asleep])
    expect(found.refused.size).toBe(0)
  })

  it("refuses two agents at one address instead of picking", () => {
    const found = directed(["mac-mini/api/api"], [entry("mac-mini/api/api"), entry("mac-mini/api/api", { id: "t9" })])
    expect(found.found).toEqual([])
    expect(found.refused.get("mac-mini/api/api")).toEqual({
      tag: "Ambiguous",
      reason:
        "2 agents answer to mac-mini/api/api (herdr-app t1, herdr-app t9); give one another address with reach pin"
    })
  })

  it("says an ended agent has ended, and that nobody is at an unknown address", () => {
    const found = directed(
      ["mac-mini/api/api", "mac-mini/web/web"],
      [entry("mac-mini/api/api", { state: "ended" }), entry("mac-mini/api/api", { state: "ended", id: "t2" })]
    )
    expect(found.refused.get("mac-mini/api/api")?.tag).toBe("Ended")
    expect(found.refused.get("mac-mini/web/web")).toEqual({
      tag: "NotFound",
      reason: "no agent is at mac-mini/web/web; reach ls lists them"
    })
  })

  it("marks every address unavailable when reach cannot be asked", () => {
    expect(unavailable(["mac-mini/api/api"], "not installed").refused.get("mac-mini/api/api")).toEqual({
      tag: "Unavailable",
      reason: "reach could not look up mac-mini/api/api: not installed"
    })
  })
})

describe("which agent a message goes to", () => {
  const agents = [
    { name: "infra", pane: "wQ:p1", machine: "devbox" },
    { name: "auth", pane: "w1:p2", machine: null },
    { name: "claude", pane: "hc:t1", machine: null },
    { name: "claude", pane: "hc:sthdev/t4", machine: "sthdev" },
    { name: "mac-mini/api/api", pane: "reach:mac-mini/api/api", machine: null }
  ]
  const none = new Map()

  it("sends to the one agent with that name or pane, on whichever machine it runs", () => {
    expect(targetFor("infra", agents, none)).toEqual({ _tag: "Target", target: { machine: "devbox", pane: "wQ:p1" } })
    expect(targetFor("w1:p2", agents, none)).toEqual({ _tag: "Target", target: { machine: null, pane: "w1:p2" } })
  })

  it("refuses a name two agents share instead of picking one", () => {
    expect(targetFor("claude", agents, none)).toEqual({
      _tag: "Refused",
      reason: "2 agents are called claude (hc:t1, sthdev hc:sthdev/t4); name one by its machine/space/name address"
    })
  })

  it("sends to an address through reach", () => {
    expect(targetFor("mac-mini/api/api", agents, none)).toEqual({
      _tag: "Target",
      target: { machine: null, pane: "reach:mac-mini/api/api" }
    })
    expect(targetFor("sthdev/ui/ui", agents, none)).toEqual({
      _tag: "Target",
      target: { machine: null, pane: "reach:sthdev/ui/ui" }
    })
  })

  it("refuses an address reach could not resolve", () => {
    const refused = new Map([["sthdev/ui/ui", { tag: "NotFound" as const, reason: "no agent is at sthdev/ui/ui" }]])
    expect(pickAgent("sthdev/ui/ui", agents, refused)).toEqual({
      _tag: "Refused",
      reason: "no agent is at sthdev/ui/ui"
    })
  })

  it("falls back to the name on this machine when no running agent has it", () => {
    expect(targetFor("ui-kit", agents, none)).toEqual({ _tag: "Target", target: { machine: null, pane: "ui-kit" } })
  })
})
