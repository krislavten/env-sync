import { execFile } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const START_MARKER = "# >>> env-sync";
const END_MARKER = "# <<< env-sync";
const ZERO_HEAD = "0000000000000000000000000000000000000000";

export type HookInstallOptions = {
  cwd: string;
  project: string;
  bin?: string;
};

export type HookInstallResult = {
  path: string;
};

export async function installHook(options: HookInstallOptions): Promise<HookInstallResult> {
  validateProject(options.project);
  const hookPath = await gitPath(options.cwd, "hooks/post-checkout");
  const existing = await readTextIfExists(hookPath);
  const block = renderHookBlock(options.project, options.bin ?? "env-sync");
  const next = upsertManagedBlock(existing ?? "#!/bin/sh\n", block);

  await writeFile(hookPath, next, "utf8");
  await chmod(hookPath, 0o755);
  return { path: hookPath };
}

export async function uninstallHook(cwd: string): Promise<HookInstallResult> {
  const hookPath = await gitPath(cwd, "hooks/post-checkout");
  const existing = await readTextIfExists(hookPath);
  if (existing === undefined) {
    return { path: hookPath };
  }
  await writeFile(hookPath, removeManagedBlock(existing), "utf8");
  return { path: hookPath };
}

export function renderHookBlock(project: string, bin: string): string {
  return `${START_MARKER}
# Managed by env-sync. Runs only for the initial checkout of a new worktree.
old_head="$1"
is_branch_checkout="$3"
zero="${ZERO_HEAD}"

if [ "$old_head" = "$zero" ] && [ "$is_branch_checkout" = "1" ]; then
  ENV_SYNC_BIN=${quoteShell(bin)}
  if [ -x "$ENV_SYNC_BIN" ] || command -v "$ENV_SYNC_BIN" >/dev/null 2>&1; then
    "$ENV_SYNC_BIN" pull ${quoteShell(project)} || {
      echo "env-sync: pull skipped or blocked; run env-sync status ${project}" >&2
    }
  else
    echo "env-sync: command not found, skip env pull" >&2
  fi
fi
${END_MARKER}
`;
}

function upsertManagedBlock(existing: string, block: string): string {
  const without = removeManagedBlock(existing).trimEnd();
  return `${without}\n\n${block}`;
}

function removeManagedBlock(existing: string): string {
  const pattern = new RegExp(`\\n?${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}\\n?`, "g");
  const next = existing.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  return next ? `${next}\n` : "";
}

async function gitPath(cwd: string, relativePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", relativePath], { cwd });
  const gitPathOutput = stdout.trim();
  return path.isAbsolute(gitPathOutput) ? gitPathOutput : path.resolve(cwd, gitPathOutput);
}

async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function validateProject(project: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project)) {
    throw new Error("project must contain only letters, numbers, dot, underscore, or dash");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
