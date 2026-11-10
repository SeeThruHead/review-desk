import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { locateScript, parseLocations, targetFor } from "./Remote.ts"

describe("finding agents' checkouts on another machine", () => {
  it("asks for every checkout's branch and remote in one shell command, quoting each path", () => {
    expect(locateScript(["/home/you/code/infra", "/home/you/it's here"])).toBe(
      `for d in '/home/you/code/infra' '/home/you/it'"'"'s here'; do printf '%s\\t%s\\t%s\\n' "$d" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)" "$(git -C "$d" remote get-url origin 2>/dev/null)"; done`
    )
  })

  it("reads one line per checkout, and a checkout git cannot read has no branch or remote", () => {
    const found = parseLocations(
      "/home/you/code/infra\tmain\tssh://git@gitea.example:2223/you/infra.git\n/nonexistent\t\t\n/half\tmain\nnoise\n"
    )

    expect(found.get("/home/you/code/infra")).toEqual({
      branch: Option.some("main"),
      remote: Option.some("ssh://git@gitea.example:2223/you/infra.git")
    })
    expect(found.get("/nonexistent")).toEqual({ branch: Option.none(), remote: Option.none() })
    expect(found.get("/half")).toEqual({ branch: Option.some("main"), remote: Option.none() })
    expect(found.size).toBe(3)
  })
})

describe("which agent a message goes to", () => {
  const agents = [
    { name: "infra", pane: "wQ:p1", machine: "devbox" },
    { name: "auth", pane: "w1:p2", machine: null }
  ]

  it("sends to the named session on whichever machine it runs", () => {
    expect(targetFor("infra", agents)).toEqual({ machine: "devbox", pane: "wQ:p1" })
    expect(targetFor("auth", agents)).toEqual({ machine: null, pane: "w1:p2" })
  })

  it("falls back to the name on this machine when no running agent has it", () => {
    expect(targetFor("ui-kit", agents)).toEqual({ machine: null, pane: "ui-kit" })
  })
})
