import { Option } from "effect"

export const shippedHostNames = ["herdr", "hc", "cmux", "orca", "rex", "tmux", "claude"] as const

export type ShippedHostName = (typeof shippedHostNames)[number]

export const unprefixedHost = "herdr"

export type Address = { readonly host: string; readonly id: string }

export const addressOf = (host: string, id: string): string => (host === unprefixedHost ? id : `${host}:${id}`)

export const addressText = (address: Address): string => addressOf(address.host, address.id)

export const parseAddress = (text: string, prefixes: ReadonlyArray<string>): Address => {
  const host = prefixes.find((prefix) => prefix !== unprefixedHost && text.startsWith(`${prefix}:`))

  return host === undefined ? { host: unprefixedHost, id: text } : { host, id: text.slice(host.length + 1) }
}

export type CallerEnv = {
  readonly herdrPane: Option.Option<string>
  readonly appTerminal: Option.Option<string>
  readonly cmuxWorkspace: Option.Option<string>
  readonly orcaTerminal: Option.Option<string>
  readonly rexBlock: Option.Option<{ readonly session: string; readonly block: string }>
  readonly tmuxPane: Option.Option<string>
  readonly claudeSession: Option.Option<string>
}

export const callerAddress = (env: CallerEnv): Option.Option<string> =>
  Option.firstSomeOf([
    env.herdrPane,
    Option.map(env.appTerminal, (id) => `hc:${id}`),
    Option.map(env.cmuxWorkspace, (id) => `cmux:${id}`),
    Option.map(env.orcaTerminal, (id) => `orca:${id}`),
    Option.map(env.rexBlock, ({ session, block }) => `rex:${session}/${block}`),
    Option.map(env.tmuxPane, (id) => `tmux:${id}`),
    Option.map(env.claudeSession, (id) => `claude:${id}`)
  ])
