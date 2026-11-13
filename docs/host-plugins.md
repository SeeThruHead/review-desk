# Host plugins

A host is anything agents run in: a terminal multiplexer, a terminal app, an editor, an agent's own inbox. The desk needs three things from a host: the agents in it, a way to hand one a message, and a way to read its screen. Every host the desk ships is built on the same contract, and anyone can add another by dropping an executable into a folder.

## The shipped hosts

All of them are on by default. Each poll the desk asks every host; one that is not installed or does not answer is skipped for that poll, and its claims are never released while it is silent.

| Host | Name (address prefix) | Source |
| --- | --- | --- |
| Herdr TUI | `herdr` (no prefix: a pane id as it is) | `packages/server/src/agents/hosts/Herdr.ts` |
| Herdr app | `hc` | `hosts/HerdrApp.ts` |
| cmux | `cmux` | `hosts/Cmux.ts` |
| Orca | `orca` | `hosts/Orca.ts` |
| Rex | `rex` | `hosts/Rex.ts` |
| tmux | `tmux` | `hosts/Tmux.ts` |
| Claude Code | `claude` | `hosts/Claude.ts` |

`hosts` in the config narrows which hosts are asked, by name; it covers plugins too.

## Adding a host: an executable

Put an executable in `~/.review-desk/plugins/` (the folder under `REVIEW_DESK_HOME`). Its file name without the extension is the host's name: `zellij.sh` becomes the host `zellij`, and its agents are addressed `zellij:<id>`. Or list it in the config, which also lets you pass fixed arguments:

```json
"plugins": [{ "name": "zellij", "command": ["/usr/local/bin/zellij-host", "--session", "work"] }]
```

A name is lowercase letters, digits and dashes, starting with a letter, and may not be a shipped host's name or another plugin's. A plugin that breaks these rules is left out with a warning in the log. Plugins are read when the desk starts; restart it (`brew services restart review-desk`) after adding one.

The desk runs the executable with one of three commands. Each run has 30 seconds.

### `list`

Print the agents as JSON on stdout and exit 0:

```json
{ "agents": [{ "id": "main/1", "cwd": "/Users/you/code/api", "status": "working", "name": "auth" }] }
```

- `id`: how this host finds the agent again. The desk addresses it as `<name>:<id>`.
- `cwd`: the folder the agent works in. The desk reads its branch and remote from there to route pull requests to it.
- `status` (optional): `idle`, `working`, `blocked` (waiting on a person) or `unknown`, the default.
- `name` (optional): a name areas and `--session` can use instead of the address.
- `space` and `address` (optional): read by [reach](https://github.com/SeeThruHead/reach), which loads the same plugins, to give the agent a stable `machine/space/name` address. Areas then name the agent by that address and the desk reaches it through reach.

Exit non-zero, or print something that is not this JSON, when the host cannot be reached. That counts as "did not answer": nothing is released. An empty list means the host answered and has no agents, so claims held by its agents start counting toward release.

`REVIEW_DESK_AGENT_PROGRAMS` holds the program names the desk counts as agents (the shipped list plus `agentCommands` from the config), comma separated, for a host that has to tell agents from plain shells.

### `send <id>`

The message arrives on stdin. Hand it to the agent as one message (a long message has several lines; paste it as one block rather than typing it line by line) and submit it. Exit 0 once it is delivered; a non-zero exit and stderr are reported as the delivery failure.

### `read <id> <lines>`

Print the bottom of the agent's screen, at least `<lines>` lines when there are that many. `review-desk agents --read <name>:<id>` shows it.

## A working example

[`plugins/tmux-panes.sh`](plugins/tmux-panes.sh) is a complete plugin in plain `sh` for tmux panes running an agent program. Copy it into the plugins folder, make it executable, restart the desk, and `review-desk agents` lists its panes under the host `tmux-panes`.

## The contract inside the desk

The shipped hosts implement the same contract in TypeScript (`packages/server/src/agents/Host.ts`):

```ts
type AgentHost = {
  name: string
  title: string
  yieldsToTerminals: boolean
  list: (env: HostEnv) => Effect<ReadonlyArray<Found>, Failure>
  send: (env: HostEnv, target: Target, text: string) => Effect<void, Failure>
  read: (env: HostEnv, target: Target, lines: number) => Effect<string, Failure>
}
```

`HostEnv` gives a host what it may use: run a command, read files, post a line to a socket, and the agent program list. Hosts that work through a CLI are written as a `CommandHost` (a `list`, the commands that send, the command that reads) and turned into an `AgentHost` by `commandHost`; the executable plugin is exactly that, with the three commands above. `yieldsToTerminals` marks a host whose agents are dropped where a terminal host already has an agent in the same folder (Claude Code, whose sessions usually also sit in a terminal). A new shipped host is one file in `agents/hosts/` and one line in `agents/Hosts.ts`.
