# env-sync

> Local-first env file synchronization for people who live across worktrees, repos, and project variants.

`env-sync` is a small CLI for keeping local `.env` files aligned without turning secrets into a shared service, a git artifact, or a Slack message.

It is built around a simple idea: env files are local operational state, but modern development is rarely done in one checkout. You may have multiple worktrees for the same repo, a web app and worker split across directories, test-only env files, and project-specific variants that should never bleed into each other. `env-sync` gives that workflow a boring, explicit, auditable local mechanism.

```sh
env-sync push pilot
env-sync pull pilot
env-sync status pilot
env-sync diff pilot
```

By default, it syncs `.env.local` in the current directory to:

```text
~/.env-sync/<project>/files/.env.local
```

No cloud account. No secret values in status output. No implicit overwrite.

## Why

Most env-file workflows fail in one of three ways:

- **Copy-paste drift**: one worktree gets the new key, another keeps the stale value.
- **Unsafe visibility**: debugging commands print secret values into logs, terminals, or shared tickets.
- **Namespace accidents**: two projects both have `.env.local`, but the contents are not interchangeable.

`env-sync` treats those as product constraints, not documentation warnings.

## Design Principles

- **Local-first**: the source of truth is on your machine, under `~/.env-sync`.
- **Project-explicit**: every sync operation belongs to a namespace such as `pilot`, `rush-app`, or `side-project`.
- **No silent clobbering**: `pull` refuses to overwrite different local content unless you pass `--force`.
- **Secret-aware output**: `status` and `diff` show key names and short digests, never raw values.
- **Repo-agnostic**: the CLI does not know or care whether the current directory is Pilot, a worktree, a monorepo package, or a standalone app.
- **Small surface area**: first make local synchronization dependable; add remote or team workflows only when the local contract is solid.

## Install

Requirements:

- Node.js 20 or newer
- pnpm 10 or newer

From npm:

```sh
npm install -g @krislavten/env-sync
```

From source:

```sh
git clone https://github.com/krislavten/env-sync.git
cd env-sync
pnpm install
pnpm build
pnpm link --global
```

Then:

```sh
env-sync --help
```

## Quick Start

Save the current directory's `.env.local` under the `pilot` namespace:

```sh
env-sync push pilot
```

Restore it in another worktree:

```sh
env-sync pull pilot
```

If the destination already has different content, the pull is blocked:

```text
.env.local: blocked-different
```

Overwrite intentionally:

```sh
env-sync pull pilot --force
```

`--force` updates the local file in place. It does not create a backup or audit trail, so use it only when the stored snapshot is the version you intend to keep.

Check whether local and stored files match:

```sh
env-sync status pilot
env-sync diff pilot
```

`diff` output is intentionally redacted:

```text
.env.local: different
  ~ API_TOKEN local:f44e64e75f39 stored:8ed3f6ad685b
  + NEW_FEATURE_FLAG stored:7f021a1415b8
```

The key names are visible. The values are not.

## Multiple Env Files

Pass extra files explicitly:

```sh
env-sync push pilot \
  --file .env.local \
  --file .env.test.local \
  --file apps/agent-hub/.env.local
```

Or create a project config:

```sh
env-sync init pilot \
  --file .env.local \
  --file .env.test.local \
  --file apps/agent-hub/.env.local
```

This writes:

```json
{
  "project": "pilot",
  "files": [
    ".env.local",
    ".env.test.local",
    "apps/agent-hub/.env.local"
  ]
}
```

`.env-sync.json` is safe to commit because it contains only the namespace and file paths, not secret values.

After `init`, the project argument becomes optional for read-only checks:

```sh
env-sync status
env-sync diff
```

## Command Reference

```text
env-sync init <project> [--file <path>...]
env-sync push <project> [--file <path>...]
env-sync pull <project> [--file <path>...] [--force]
env-sync status [project] [--file <path>...]
env-sync diff [project] [--file <path>...]
```

If no `--file` is provided, `env-sync` uses files from `.env-sync.json`. If no config exists, it falls back to `.env.local`.

## Storage Model

Each project namespace gets its own directory:

```text
~/.env-sync/
  pilot/
    files/
      .env.local
      .env.test.local
      apps/agent-hub/.env.local
  rush-app/
    files/
      .env.local
```

This is deliberately plain. You can inspect it, back it up, remove it, or copy it between machines using tools you already trust.

The CLI creates project store directories with owner-only directory permissions and writes synced files with owner-only file permissions where the platform supports POSIX modes. The contents are still plaintext on disk.

## Safety Model

`env-sync` is not a secret manager. It is a local file synchronization tool with conservative defaults.

What it does:

- Keeps project namespaces separated.
- Refuses accidental overwrites.
- Avoids printing secret values in `status` and `diff`.
- Stores synced files with owner-only file permissions where the platform supports it.
- Rejects env file paths outside the current project directory.

What it does not do:

- Encrypt stored env files.
- Manage cloud secret rotation.
- Share secrets with teammates.
- Decide which values are production-safe.

If you need centralized access control, audit logs, or encryption at rest, use a real secret manager. `env-sync` is for the local development gap before that system should be involved.

## Development

```sh
pnpm install
pnpm check
```

`pnpm check` runs TypeScript build and tests.

## Roadmap

- Safer `init` flows for existing repos and worktrees.
- Optional named profiles per project, for example `pilot/testing` and `pilot/dogfood`.
- Better human-readable summaries for added, removed, and changed keys.
- Optional encrypted local store.
- Optional import/export bundles for machine migration.

The project will stay local-first unless there is a clear reason to expand the trust boundary.

## License

MIT
