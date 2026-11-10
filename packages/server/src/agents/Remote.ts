import { Option } from "effect"

export type AgentTarget = { readonly machine: string | null; readonly pane: string }

export type Location = { readonly branch: Option.Option<string>; readonly remote: Option.Option<string> }

const quoted = (text: string): string => `'${text.replaceAll("'", `'"'"'`)}'`

export const locateScript = (cwds: ReadonlyArray<string>): string =>
  `for d in ${cwds.map(quoted).join(" ")}; do printf '%s\\t%s\\t%s\\n' "$d" "$(git -C "$d" rev-parse --abbrev-ref HEAD 2>/dev/null)" "$(git -C "$d" remote get-url origin 2>/dev/null)"; done`

const field = (parts: ReadonlyArray<string>, index: number): string => parts[index] ?? ""

const present = (text: string): Option.Option<string> => (text === "" ? Option.none() : Option.some(text))

export const parseLocations = (text: string): ReadonlyMap<string, Location> =>
  new Map(
    text
      .split("\n")
      .filter((line) => line.includes("\t"))
      .map((line) => {
        const parts = line.split("\t")

        return [field(parts, 0), { branch: present(field(parts, 1)), remote: present(field(parts, 2)) }] as const
      })
  )

export const targetFor = (
  name: string,
  agents: ReadonlyArray<{ readonly name: string; readonly pane: string; readonly machine: string | null }>
): AgentTarget => {
  const found = agents.find((agent) => agent.name === name)

  return found === undefined ? { machine: null, pane: name } : { machine: found.machine, pane: found.pane }
}
