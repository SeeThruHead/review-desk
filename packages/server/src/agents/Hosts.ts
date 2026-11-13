import { type HostKind, type TerminalKind, allHostKinds } from "./Address.ts"
import type { TerminalHost } from "./Host.ts"
import { cmux } from "./hosts/Cmux.ts"
import { herdr } from "./hosts/Herdr.ts"
import { herdrApp } from "./hosts/HerdrApp.ts"
import { orca } from "./hosts/Orca.ts"
import { rex } from "./hosts/Rex.ts"
import { tmux } from "./hosts/Tmux.ts"

export const terminalHosts: { readonly [K in TerminalKind]: TerminalHost } = {
  herdr,
  hc: herdrApp,
  cmux,
  orca,
  rex,
  tmux
}

export const enabledHosts = (chosen: ReadonlyArray<HostKind> | undefined): ReadonlyArray<HostKind> =>
  chosen === undefined ? allHostKinds : allHostKinds.filter((kind) => chosen.includes(kind))

export const enabledTerminals = (chosen: ReadonlyArray<HostKind> | undefined): ReadonlyArray<TerminalHost> =>
  Object.values(terminalHosts).filter((host) => enabledHosts(chosen).includes(host.kind))
