import type { AgentHost, Found } from "./Host.ts"
import { claudeHost } from "./hosts/Claude.ts"
import { cmux } from "./hosts/Cmux.ts"
import { herdr } from "./hosts/Herdr.ts"
import { herdrApp } from "./hosts/HerdrApp.ts"
import { orca } from "./hosts/Orca.ts"
import { rex } from "./hosts/Rex.ts"
import { tmux } from "./hosts/Tmux.ts"

export const shippedHosts = (claudeSessions: string): ReadonlyArray<AgentHost> => [
  herdr,
  herdrApp,
  cmux,
  orca,
  rex,
  tmux,
  claudeHost(claudeSessions)
]

export const enabledHosts = (
  hosts: ReadonlyArray<AgentHost>,
  chosen: ReadonlyArray<string> | undefined
): ReadonlyArray<AgentHost> => (chosen === undefined ? hosts : hosts.filter((host) => chosen.includes(host.name)))

export const prefixesOf = (hosts: ReadonlyArray<AgentHost>): ReadonlyArray<string> => hosts.map((host) => host.name)

export const yieldToTerminals = (
  found: ReadonlyArray<{ readonly host: AgentHost; readonly agents: ReadonlyArray<Found> }>
): ReadonlyArray<Found> => {
  const terminals = found.filter((one) => !one.host.yieldsToTerminals).flatMap((one) => one.agents)
  const yielding = found
    .filter((one) => one.host.yieldsToTerminals)
    .flatMap((one) => one.agents)
    .filter((agent) => !terminals.some((terminal) => terminal.cwd === agent.cwd))

  return [...terminals, ...yielding]
}
