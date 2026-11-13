import { Schema } from "effect"
import type { AgentTarget } from "./Remote.ts"

export const agentAddressPattern = /^[^/:\s]+\/[^/:\s]+\/[^/:\s]+$/

export const isAgentAddress = (text: string): boolean => agentAddressPattern.test(text)

export const reachPane = (address: string): string => `reach:${address}`

export const DirectoryAgent = Schema.Struct({
  address: Schema.String,
  state: Schema.String,
  status: Schema.String,
  host: Schema.String,
  id: Schema.String,
  cwd: Schema.String
})
export type DirectoryAgent = typeof DirectoryAgent.Type

export const Directory = Schema.Struct({ agents: Schema.Array(DirectoryAgent) })

export type RefusalTag = "NotFound" | "Ambiguous" | "Ended" | "Unavailable"

export type Refusal = { readonly tag: RefusalTag; readonly reason: string }

export type Refusals = ReadonlyMap<string, Refusal>

export type Directed = { readonly found: ReadonlyArray<DirectoryAgent>; readonly refused: Refusals }

type Resolved = { readonly found: DirectoryAgent } | { readonly refused: Refusal }

const resolveIn = (agents: ReadonlyArray<DirectoryAgent>, address: string): Resolved => {
  const here = agents.filter((agent) => agent.address === address)
  const running = here.filter((agent) => agent.state !== "ended")
  const only = running[0]
  if (running.length > 1)
    return {
      refused: {
        tag: "Ambiguous",
        reason: `${running.length} agents answer to ${address} (${running.map((agent) => `${agent.host} ${agent.id}`).join(", ")}); give one another address with reach pin`
      }
    }
  if (only !== undefined) return { found: only }
  if (here.length > 0)
    return {
      refused: { tag: "Ended", reason: `the agent at ${address} has ended; start it with reach reopen ${address}` }
    }

  return { refused: { tag: "NotFound", reason: `no agent is at ${address}; reach ls lists them` } }
}

export const directed = (addresses: ReadonlyArray<string>, agents: ReadonlyArray<DirectoryAgent>): Directed => {
  const resolved = addresses.map((address) => [address, resolveIn(agents, address)] as const)

  return {
    found: resolved.flatMap(([, one]) => ("found" in one ? [one.found] : [])),
    refused: new Map(resolved.flatMap(([address, one]) => ("refused" in one ? [[address, one.refused] as const] : [])))
  }
}

export const unavailable = (addresses: ReadonlyArray<string>, reason: string): Directed => ({
  found: [],
  refused: new Map(
    addresses.map((address) => [
      address,
      { tag: "Unavailable", reason: `reach could not look up ${address}: ${reason}` }
    ])
  )
})

export const addressesIn = (wanted: Iterable<string>): ReadonlyArray<string> => [
  ...new Set([...wanted].filter(isAgentAddress))
]

type Reachable = { readonly name: string; readonly pane: string; readonly machine: string | null }

export type Picked<A> =
  | { readonly _tag: "One"; readonly agent: A }
  | { readonly _tag: "None" }
  | { readonly _tag: "Refused"; readonly reason: string }

const placeText = (agent: Reachable): string => (agent.machine === null ? agent.pane : `${agent.machine} ${agent.pane}`)

export const pickAgent = <A extends Reachable>(
  wanted: string,
  agents: ReadonlyArray<A>,
  refused: Refusals
): Picked<A> => {
  const matches = agents.filter((agent) => agent.name === wanted || agent.pane === wanted)
  const only = matches[0]
  const refusal = refused.get(wanted)
  if (matches.length > 1)
    return {
      _tag: "Refused",
      reason: `${matches.length} agents are called ${wanted} (${matches.map(placeText).join(", ")}); name one by its machine/space/name address`
    }
  if (only !== undefined) return { _tag: "One", agent: only }
  if (refusal !== undefined) return { _tag: "Refused", reason: refusal.reason }

  return { _tag: "None" }
}

export type Targeted =
  | { readonly _tag: "Target"; readonly target: AgentTarget }
  | { readonly _tag: "Refused"; readonly reason: string }

export const targetOf = (wanted: string, picked: Picked<Reachable>): Targeted => {
  if (picked._tag === "Refused") return picked
  if (picked._tag === "One")
    return { _tag: "Target", target: { machine: picked.agent.machine, pane: picked.agent.pane } }

  return { _tag: "Target", target: { machine: null, pane: isAgentAddress(wanted) ? reachPane(wanted) : wanted } }
}

export const targetFor = (wanted: string, agents: ReadonlyArray<Reachable>, refused: Refusals): Targeted =>
  targetOf(wanted, pickAgent(wanted, agents, refused))
