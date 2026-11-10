import { Option } from "effect"

export const hostKinds = ["hc", "cmux", "orca", "tmux", "claude"] as const

export type HostKind = "herdr" | (typeof hostKinds)[number]

export type Address = { readonly host: HostKind; readonly id: string }

export const addressText = (address: Address): string =>
  address.host === "herdr" ? address.id : `${address.host}:${address.id}`

const prefixed = (text: string) => hostKinds.find((host) => text.startsWith(`${host}:`))

export const parseAddress = (text: string): Address => {
  const host = prefixed(text)

  return host === undefined ? { host: "herdr", id: text } : { host, id: text.slice(host.length + 1) }
}

export type CallerEnv = {
  readonly herdrPane: Option.Option<string>
  readonly appTerminal: Option.Option<string>
  readonly cmuxWorkspace: Option.Option<string>
  readonly orcaTerminal: Option.Option<string>
  readonly tmuxPane: Option.Option<string>
  readonly claudeSession: Option.Option<string>
}

export const callerAddress = (env: CallerEnv): Option.Option<string> =>
  Option.firstSomeOf([
    env.herdrPane,
    Option.map(env.appTerminal, (id) => `hc:${id}`),
    Option.map(env.cmuxWorkspace, (id) => `cmux:${id}`),
    Option.map(env.orcaTerminal, (id) => `orca:${id}`),
    Option.map(env.tmuxPane, (id) => `tmux:${id}`),
    Option.map(env.claudeSession, (id) => `claude:${id}`)
  ])
