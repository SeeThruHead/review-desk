# Review Desk

Agents do the first rounds of code review with each other; you get a queue of the pull requests that are ready for a person, sorted by how much of your attention they need.

- Someone asks you for a review (a review request, or the `agent-review` label). Your desk hands it to the agent (Claude Code, Codex, pi and the like) that owns that part of the code, in whatever terminal it runs in.
- That agent reviews and posts its findings through the desk. The author's desk hands them to the agent on the branch, which fixes them and replies. They go back and forth, at most three rounds per thread.
- When they have settled everything, the pull request lands in **Needs you**, grouped as _needs your architectural eye_, _worth a real look_ or _probably safe, skim it_, with what the agents settled.

**Needs you** also lists, each with why, everything else that is waiting on you:

- A review request no agent area covers.
- A pull request you review where the author changed the code under your comment without replying: they may have fixed it with a commit, so check.
- One of your own pull requests that a person commented on or asked changes for, that is ready to merge, that left the merge queue, or whose CI failed with no agent working on it.
- An issue or pull request in your configured repositories where someone @mentioned you. Mention text is shown to you only; it never reaches an agent.

**Seen** (on the board, or `review-desk seen <forge:owner/repo#n>`) clears an item without replying, until something new happens on it.

The board's sections are Reviewing, Your pull requests, Mentions and History. The board and the menu bar both say when their data is stale, for example after GitHub's rate limit paused reading, and when routing is off because no areas are configured.

It works with people who run prwatch or nothing at all: those comments are treated as a person's.

## Install (macOS, Apple silicon)

```sh
brew install seethruhead/tap/review-desk
mkdir -p ~/.review-desk && cp "$(brew --prefix review-desk)/share/review-desk/config.example.json" ~/.review-desk/config.json   # then edit it
brew services start review-desk
```

The service runs the menu bar tray, which starts and restarts the server. Open http://127.0.0.1:4790. It needs `gh` logged in for GitHub.

## Where your agents can run

Herdr is optional. Every terminal host below is built in and on by default: each poll the desk asks every one whose CLI answers, so any mix of them works at once, and nothing else needs installing.

| Host | Lists agents with | Hands work over with | Knows what the agent is doing from |
| --- | --- | --- | --- |
| Herdr TUI | `herdr agent list` (and `--machine` for linked machines) | `herdr agent prompt` | Herdr's own status |
| Herdr app | `hc ls --json` (and its linked machines) | `hc send` | the app's own status |
| tmux | panes running a known agent program | one bracketed paste, then Enter | the bottom of the screen (asking, working or waiting) |
| cmux | each workspace's sidebar | one bracketed paste, then Enter | the sidebar's agent state |
| Orca | `orca terminal list --json` | `orca terminal send --enter` | not reported |
| Rex | blocks running a known agent program | one bracketed paste with `rex send`, then Enter | the program's own status report (OSC 7501) |
| Claude Code | sessions with an inbox and no terminal of their own | the session's inbox | the session's status |

Any other host can be added without changing the desk: drop an executable that answers `list`, `send` and `read` into `~/.review-desk/plugins/`. [docs/host-plugins.md](docs/host-plugins.md) has the contract and a working example; the hosts above are built on the same contract.

### Agent addresses

When [reach](https://github.com/SeeThruHead/reach) is installed, an area, `claim --session` and `agents --read` can name an agent by its address, `machine/space/name`, which stays the same when its terminal is replaced or renamed. The desk looks addresses up with `reach ls` each poll and hands messages over with `reach send`, which wakes an agent that is asleep. An address that is missing, ended or shared by two agents is refused, never swapped for a near match. Without reach, or for agents without a pinned address, names and terminal addresses work as before, except that a name two agents share is refused rather than given to whichever is listed first.

`review-desk agents` prints every agent the desk can reach, with its host and what it is doing; `review-desk agents --read <agent>` prints the bottom of its screen.

## Run it from source

```sh
bun install
(cd packages/web && bun run build)
mkdir -p ~/.review-desk && cp docs/config.example.json ~/.review-desk/config.json   # then edit it
cd packages/server && bun run desk serve
```

Open http://127.0.0.1:4790. For the menu bar, build the tray (`cd tray && cargo build --release`) and run it with `REVIEW_DESK_SERVER` set to a compiled `review-desk` (`cd packages/server && bun run compile`); it starts and restarts the server itself.

Agents use the same binary: `review-desk comment`, `review-desk triage` and `review-desk claim`. The brief the desk sends them explains how. A claim whose agent has been gone for `claimGraceMinutes` (default 30) is released by the desk, so a closed pane never holds work.

## SketchyBar

`review-desk sketchybar` registers and triggers the `review_desk_update` event with `READY` (how many things need you), `WORKING`, `TALKING` and `HEALTH` (`live`, `stale` or `paused`). A plugin:

```sh
sketchybar --add item review_desk right \
           --subscribe review_desk review_desk_update \
           --set review_desk script='sketchybar --set $NAME label="RD $READY"'
```

On Linux, Waybar can poll `review-desk summary`, which prints the summary as JSON: `needsYou`, each section's `total` and `needsYou`, the agents, the top items with why, `health` and `routing`.

## Config

`~/.review-desk/config.json` (`REVIEW_DESK_HOME` moves it):

- `desk` and `aliases`: your logins on each forge.
- `roles`: `author`, `reviewer` or both.
- `repos` and `people`: the only repositories and people whose pull requests and comments may reach an agent.
- `owners` (optional): the only repository owners this desk may read, for example `["you", "you-gitea"]` on a personal machine. A desk refuses to start when `repos` lists anything outside them, and `gitea.discoverOwned` never adds one. Without it every owner is allowed.
- `areas`: which agent reviews which repositories (and, optionally, paths). Name the agent with `agent`, its stable `machine/space/name` address (for example `"agent": "mac-mini/api/api"`), when [reach](https://github.com/SeeThruHead/reach) is installed; or with `session`, an agent name or a terminal address in any host (`w1:p2`, `hc:t11`, `tmux:%3`, `cmux:<id>`, `orca:<id>`, `rex:<session>/<block>`, `claude:<session>`). The desk never guesses: when two agents share the name, or reach finds nobody (or more than one agent) at the address, it sends nothing and the pull request shows in Needs you with the reason. With no areas, review requests stay with you, and the board says so.
- `hosts` (optional): which hosts to ask, by name: `herdr`, `hc`, `cmux`, `orca`, `rex`, `tmux`, `claude` and any plugin's. Without it every host is asked, and one that is not installed is simply skipped.
- `plugins` (optional): host plugins with fixed arguments, as `{ "name": …, "command": [...] }`, besides the executables in `~/.review-desk/plugins/` ([docs/host-plugins.md](docs/host-plugins.md)).
- `agentCommands` (optional): more program names that count as an agent in a tmux pane or a Rex block, on top of `claude`, `codex`, `opencode`, `gemini`, `pi`, `amp`, `aider` and `cursor-agent`.
- `roundLimit`, `intakeLabel`, `port`.
- `pollSeconds` (optional): how often the desk polls, 30 seconds by default. ETag requests keep this cheap: a desk uses a few GitHub calls an hour out of 5,000.
- `sidediff.checkouts`: where to open pull requests in sidediff.
- `github.tokenCommand` (for example `["gh", "auth", "token"]`). A token from your own account shares that account's hourly limits with everything else you run; to give the desk its own, use a token for a separate identity (a GitHub App installation or a machine account) and set `github.login` to your login, so the searches look for you instead of `@me`. and `gitea.url` / `gitea.tokenFile` (a token with `write:issue` and `write:repository`). `gitea.discoverOwned: true` also watches every repository on Gitea owned by the desk's logins, so new ones need no config change.
