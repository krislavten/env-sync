import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { installHook, uninstallHook } from "../src/index.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("git worktree hook", () => {
  it("pulls env files when git worktree add triggers post-checkout", async () => {
    const root = await tempRoot();
    const repo = path.join(root, "repo");
    const worktree = path.join(root, "repo-feature");
    const home = path.join(root, "home");
    const shim = path.join(root, "env-sync-shim");

    await writeFile(
      shim,
      `#!/bin/sh
HOME=${quoteShell(home)} exec ${quoteShell(process.execPath)} ${quoteShell(fileURLToPath(new URL("../dist/cli.js", import.meta.url)))} "$@"
`,
      "utf8",
    );
    await chmod(shim, 0o755);

    await git(["init", "--initial-branch=main"], repo);
    await git(["config", "user.email", "env-sync@example.test"], repo);
    await git(["config", "user.name", "Env Sync Test"], repo);

    await writeFile(path.join(repo, ".env-sync.json"), JSON.stringify({ project: "pilot", files: [".env.local"] }, null, 2), "utf8");
    await writeFile(path.join(repo, "README.md"), "# fixture\n", "utf8");
    await git(["add", ".env-sync.json", "README.md"], repo);
    await git(["commit", "-m", "initial"], repo);

    await mkdir(path.join(home, ".env-sync", "pilot", "files"), { recursive: true });
    await writeFile(path.join(home, ".env-sync", "pilot", "files", ".env.local"), "TOKEN=from-store\n", "utf8");
    await installHook({ cwd: repo, project: "pilot", bin: shim });

    await git(["worktree", "add", worktree, "-b", "feature/env"], repo);

    await expect(readFile(path.join(worktree, ".env.local"), "utf8")).resolves.toBe("TOKEN=from-store\n");
  });

  it("uninstalls only the env-sync managed block", async () => {
    const root = await tempRoot();
    const repo = path.join(root, "repo");

    await git(["init", "--initial-branch=main"], repo);
    await installHook({ cwd: repo, project: "pilot", bin: "env-sync" });

    const hookPath = path.join(repo, ".git", "hooks", "post-checkout");
    const installed = await readFile(hookPath, "utf8");
    await writeFile(hookPath, `${installed}\necho user hook\n`, "utf8");

    await uninstallHook(repo);

    const uninstalled = await readFile(hookPath, "utf8");
    expect(uninstalled).not.toContain("# >>> env-sync");
    expect(uninstalled).not.toContain("# <<< env-sync");
    expect(uninstalled).toContain("echo user hook");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "env-sync-hook-test-"));
  tempDirs.push(root);
  await import("node:fs/promises").then(({ mkdir }) => Promise.all([mkdir(path.join(root, "repo"), { recursive: true }), mkdir(path.join(root, "home"), { recursive: true })]));
  return root;
}

async function git(args: string[], cwd: string): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}
