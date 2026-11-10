# AGENTS.md

Review Desk: agents do the first review rounds with each other over pull request comments, and the person gets a queue of what is ready for them. Read `docs/architecture.md` first: the pieces, the lifecycle, the comment protocol and the decisions. `CLAUDE.md` is a symlink to this file.

## Commands

Each command is a package script; moon wraps them with inputs for caching. Run them one at a time.

- `bun install` installs and runs `setup` (patches tsgo into TypeScript and oxlint, installs the lefthook hooks).
- `bun run check` runs every package's typecheck, lint, format check and tests through moon. CI on GitHub Actions runs the same, and a `v*` tag builds the macOS release.
- In `packages/web`: `bun run storybook` (port 6130), `bun run test:components <story files> --coverage.enabled=false` for the stories you changed, `bun run build` for the page the server serves.
- In `packages/server`: `bun run desk serve` runs a desk from source (`REVIEW_DESK_HOME` picks its folder), `bun run compile` builds `dist/review-desk` with the web page inside it.
- In `tray`: `cargo build --release`, `cargo test`.
- Tickets: `tk ready`, ids `rd-xxxx`.

sth-ui is the one package `@seethruhead/sth-ui` from npm (source github.com/SeeThruHead/sth-ui). `packages/web` pins an exact release; moving to a newer sth-ui is a deliberate version bump. `packages/web/sthUi.ts` holds the StyleX setup that compiles sth-ui's styles with the app's.

## How it starts

`packages/server/src/main.ts` is the only entry point and the only `Effect.run*` (through `BunRuntime.runMain`). `review-desk serve` builds the layers: config, Shell, the GitHub and Gitea readers, Herdr agents, SQLite records, the Desk service and the HTTP server. The other subcommands (`comment`, `triage`, `claim`, `summary`, `sketchybar`) are RPC clients of a running desk at `REVIEW_DESK_URL`.

The web page starts in `packages/web/src/main.ts`; the board page lives in `src/pages/board` (model, messages, update, commands, subscriptions, view).

## What the linter enforces

`packages/lint/house-rules.ts`, with a fixture for every rule:

- No loops, `let`, mutation, comments, nested `if`, multi-line `&&`/`||` chains or casts. Deterministic time and randomness.
- `Effect.run*` only in `src/main.ts` and `tools/`.
- In `packages/web`, HTML and styles only in `src/components` and `src/theme`; pages compose components.
- RPC procedures (`Rpc.make`, `RpcGroup.make`) only in `packages/contract/src/Contract.ts`.
- Only `packages/server/src/platform/Shell.ts` starts processes; only repos, `Database.ts` and migrations use SQL.
- Package layers: contract imports nothing of ours; domain imports contract; web and server import contract and domain; web never imports server code, Bun or Node modules. Domain holds no services or layers.

## What reviewers check instead

- Pure modules stay pure: `domain/*`, `server/src/desk/Plan.ts` and `Messages.ts` take values and return values. I/O happens in `Desk.ts`, the forge readers, `Agents.ts`, `DeskRepo.ts` and `Shell.ts`.
- Every input from outside is decoded with Schema at the edge: forge responses, Herdr output, the config file, CLI flags.
- Nothing from an untrusted repository or person can reach an agent. A change to `Plan.ts` keeps the trust tests passing and adds one for any new path to an agent.
- The comment marker and the RPC contract only grow: never rename or remove a field, a procedure or a marker key; old markers must keep parsing.
- Components are composable (`Name(h, props)`, children over long prop lists) and every component and page state has a story with a play test that finds things by role and name.
- No employer names, internal hostnames or private details anywhere in the repo.
