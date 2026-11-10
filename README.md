# Review Desk

Agents do the first rounds of code review with each other; you get a queue of the pull requests that are ready for a person, sorted by how much of your attention they need.

- Someone asks you for a review (a review request, or the `agent-review` label). Your desk hands it to the Claude Code session in Herdr that owns that part of the code.
- That agent reviews and posts its findings through the desk. The author's desk hands them to the agent on the branch, which fixes them and replies. They go back and forth, at most three rounds per thread.
- When they have settled everything, the pull request lands in **Ready for you**, grouped as _needs your architectural eye_, _worth a real look_ or _probably safe, skim it_, with what the agents settled.

It works with people who run prwatch or nothing at all: those comments are treated as a person's.

## Install (macOS, Apple silicon)

```sh
brew install seethruhead/tap/review-desk
mkdir -p ~/.review-desk && cp "$(brew --prefix review-desk)/share/review-desk/config.example.json" ~/.review-desk/config.json   # then edit it
brew services start review-desk
```

The service runs the menu bar tray, which starts and restarts the server. Open http://127.0.0.1:4790. It needs `gh` logged in for GitHub and Herdr on the PATH for delivering to agents.

## Run it from source

```sh
bun install
(cd packages/web && bun run build)
mkdir -p ~/.review-desk && cp docs/config.example.json ~/.review-desk/config.json   # then edit it
cd packages/server && bun run desk serve
```

Open http://127.0.0.1:4790. For the menu bar, build the tray (`cd tray && cargo build --release`) and run it with `REVIEW_DESK_SERVER` set to a compiled `review-desk` (`cd packages/server && bun run compile`); it starts and restarts the server itself.

Agents use the same binary: `review-desk comment`, `review-desk triage` and `review-desk claim`. The brief the desk sends them explains how.

## SketchyBar

`review-desk sketchybar` registers and triggers the `review_desk_update` event with `READY`, `WORKING` and `TALKING`. A plugin:

```sh
sketchybar --add item review_desk right \
           --subscribe review_desk review_desk_update \
           --set review_desk script='sketchybar --set $NAME label="RD $READY"'
```

On Linux, Waybar can poll `review-desk summary`, which prints the same counts as JSON.

## Config

`~/.review-desk/config.json` (`REVIEW_DESK_HOME` moves it):

- `desk` and `aliases`: your logins on each forge.
- `roles`: `author`, `reviewer` or both.
- `repos` and `people`: the only repositories and people whose pull requests and comments may reach an agent.
- `areas`: which Herdr session reviews which repositories (and, optionally, paths).
- `roundLimit`, `intakeLabel`, `pollSeconds`, `port`.
- `sidediff.checkouts`: where to open pull requests in sidediff.
- `github.tokenCommand` (for example `["gh", "auth", "token"]`) and `gitea.url` / `gitea.tokenFile` (a token with `write:issue` and `write:repository`). `gitea.discoverOwned: true` also watches every repository on Gitea owned by the desk's logins, so new ones need no config change.
