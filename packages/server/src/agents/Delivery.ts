import { parseAddress } from "./Address.ts"
import type { AgentTarget } from "./Remote.ts"
import { bracketed } from "./Terminals.ts"

export type Step = { readonly command: string; readonly args: ReadonlyArray<string>; readonly stdin?: string }

export type Delivery =
  | { readonly _tag: "Commands"; readonly steps: ReadonlyArray<Step> }
  | { readonly _tag: "Inbox"; readonly session: string }

const buffer = (id: string) => `review-desk-${id.replace(/\W/g, "")}`

const commands = (...steps: ReadonlyArray<Step>): Delivery => ({ _tag: "Commands", steps })

const herdrMachine = (target: AgentTarget): ReadonlyArray<string> =>
  target.machine === null ? [] : ["--machine", target.machine]

export const deliveryFor = (target: AgentTarget, text: string): Delivery => {
  const address = parseAddress(target.pane)
  if (address.host === "claude") return { _tag: "Inbox", session: address.id }
  if (address.host === "hc") return commands({ command: "hc", args: ["send", address.id, text] })
  if (address.host === "orca") {
    return commands({
      command: "orca",
      args: ["terminal", "send", "--terminal", address.id, "--text", text, "--enter"]
    })
  }
  if (address.host === "cmux") {
    return commands(
      { command: "cmux", args: ["set-buffer", "--name", buffer(address.id), bracketed(text)] },
      { command: "cmux", args: ["paste-buffer", "--name", buffer(address.id), "--workspace", address.id] },
      { command: "cmux", args: ["send-key", "--workspace", address.id, "enter"] }
    )
  }
  if (address.host === "tmux") {
    return commands(
      { command: "tmux", args: ["load-buffer", "-b", buffer(address.id), "-"], stdin: text },
      { command: "tmux", args: ["paste-buffer", "-p", "-d", "-b", buffer(address.id), "-t", address.id] },
      { command: "tmux", args: ["send-keys", "-t", address.id, "Enter"] }
    )
  }

  return commands({ command: "herdr", args: [...herdrMachine(target), "agent", "prompt", address.id, text] })
}
