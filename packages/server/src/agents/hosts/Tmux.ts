import { Effect, Option, Schema } from "effect"
import { type Found, type Run, type Status, type TerminalHost, bufferName, lastLines } from "../Host.ts"

export const tmuxFormat = "#{pane_id}\t#{pane_current_path}\t#{pane_current_command}"

const TmuxLine = Schema.Tuple([Schema.String, Schema.String, Schema.String])

export type Pane = { readonly id: string; readonly cwd: string }

const paneOf =
  (agentPrograms: ReadonlySet<string>) =>
  (line: string): ReadonlyArray<Pane> =>
    Option.match(Schema.decodeUnknownOption(TmuxLine)(line.split("\t")), {
      onNone: () => [],
      onSome: ([id, cwd, command]) => (agentPrograms.has(command) ? [{ id, cwd }] : [])
    })

export const tmuxPanes = (text: string, agentPrograms: ReadonlySet<string>): ReadonlyArray<Pane> =>
  text.split("\n").flatMap(paneOf(agentPrograms))

const asking =
  /do you want to (proceed|make this edit|create|allow)|would you like to (run|make|apply)|allow (this|command)|\[y\/n\]|press enter to (confirm|approve)/i

const busy = /esc to interrupt|ctrl\+c to interrupt|esc to cancel/i

export const screenStatus = (screen: string): Status => {
  const bottom = lastLines(screen, 15)
  if (asking.test(bottom)) return "blocked"
  if (busy.test(bottom)) return "working"

  return "idle"
}

const statusOfPane = (run: Run, pane: Pane) =>
  run({ command: "tmux", args: ["capture-pane", "-p", "-t", pane.id] }).pipe(
    Effect.map(screenStatus),
    Effect.orElseSucceed((): Status => "unknown")
  )

const foundOf = (run: Run, pane: Pane) =>
  Effect.map(statusOfPane(run, pane), (status): Found => ({ pane: `tmux:${pane.id}`, cwd: pane.cwd, status }))

export const tmux: TerminalHost = {
  kind: "tmux",
  title: "tmux",
  list: (run, agentPrograms) =>
    run({ command: "tmux", args: ["list-panes", "-a", "-F", tmuxFormat] }).pipe(
      Effect.flatMap((text) =>
        Effect.forEach(tmuxPanes(text, agentPrograms), (pane) => foundOf(run, pane), { concurrency: 4 })
      )
    ),
  send: (id, _machine, text) => [
    { command: "tmux", args: ["load-buffer", "-b", bufferName(id), "-"], stdin: text },
    { command: "tmux", args: ["paste-buffer", "-p", "-d", "-b", bufferName(id), "-t", id] },
    { command: "tmux", args: ["send-keys", "-t", id, "Enter"] }
  ],
  read: (id, _machine, lines) => ({ command: "tmux", args: ["capture-pane", "-p", "-t", id, "-S", `-${lines}`] })
}
