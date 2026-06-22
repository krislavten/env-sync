# env-sync

A small local CLI for syncing env files across worktrees and projects without leaking secret values in status output.

`env-sync` stores snapshots under `~/.env-sync/<project>/files/` and requires an explicit project namespace for `pull`, `push`, `status`, and `diff`.

## Install

```sh
pnpm install
pnpm build
pnpm link --global
```

## Usage

By default, commands operate on `.env.local` in the current directory:

```sh
env-sync push pilot
env-sync pull pilot
env-sync status pilot
env-sync diff pilot
```

Add extra files explicitly:

```sh
env-sync push pilot --file .env.test.local --file apps/agent-hub/.env.local
```

Or create a local config:

```sh
env-sync init pilot --file .env.test.local --file apps/agent-hub/.env.local
env-sync status
```

`.env-sync.json` is intentionally safe to commit because it stores file paths and the namespace, not secret values.

## Safety defaults

- Project namespaces are explicit, so `pilot`, `rush-app`, and other projects do not share snapshots.
- `pull` refuses to overwrite an existing local file with different content unless `--force` is passed.
- `status` and `diff` only show env key names and short SHA-256 digests, never secret values.
- Paths must stay inside the current project directory.

## Commands

```text
env-sync init <project> [--file <path>...]
env-sync push <project> [--file <path>...]
env-sync pull <project> [--file <path>...] [--force]
env-sync status [project] [--file <path>...]
env-sync diff [project] [--file <path>...]
```

If no `--file` is provided, the CLI uses files from `.env-sync.json`. If no config exists, it falls back to `.env.local`.
