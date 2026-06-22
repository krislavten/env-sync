import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { diffText, pull, push, redactEnv, status, type ResolvedScope } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("env-sync core", () => {
  it("pushes and pulls the default env file without leaking values in status", async () => {
    const { cwd, storeRoot, scope } = await fixture("pilot");
    await writeFile(path.join(cwd, ".env.local"), "TOKEN=local-secret\nPUBLIC_FLAG=on\n", "utf8");

    expect(await push(scope)).toEqual([{ file: ".env.local", action: "stored" }]);

    await rm(path.join(cwd, ".env.local"));
    expect(await pull(scope)).toEqual([{ file: ".env.local", action: "created" }]);
    await expect(readFile(path.join(cwd, ".env.local"), "utf8")).resolves.toBe("TOKEN=local-secret\nPUBLIC_FLAG=on\n");

    const entries = await status(scope);
    expect(entries[0]?.state).toBe("same");
    expect(JSON.stringify(entries)).not.toContain("local-secret");
    expect(storeRoot).toContain("pilot");
  });

  it("blocks overwriting different local content unless force is set", async () => {
    const { cwd, scope } = await fixture("pilot");
    await writeFile(path.join(cwd, ".env.local"), "TOKEN=from-store\n", "utf8");
    await push(scope);
    await writeFile(path.join(cwd, ".env.local"), "TOKEN=local-change\n", "utf8");

    expect(await pull(scope)).toEqual([{ file: ".env.local", action: "blocked-different" }]);
    await expect(readFile(path.join(cwd, ".env.local"), "utf8")).resolves.toBe("TOKEN=local-change\n");

    expect(await pull(scope, true)).toEqual([{ file: ".env.local", action: "updated" }]);
    await expect(readFile(path.join(cwd, ".env.local"), "utf8")).resolves.toBe("TOKEN=from-store\n");
  });

  it("keeps project namespaces isolated", async () => {
    const root = await tempRoot();
    const cwd = path.join(root, "project");
    const pilot: ResolvedScope = { cwd, project: "pilot", files: [".env.local"], storeRoot: path.join(root, "store", "pilot") };
    const rush: ResolvedScope = { cwd, project: "rush-app", files: [".env.local"], storeRoot: path.join(root, "store", "rush-app") };

    await writeFile(path.join(cwd, ".env.local"), "TOKEN=pilot\n", "utf8");
    await push(pilot);
    await writeFile(path.join(cwd, ".env.local"), "TOKEN=rush\n", "utf8");
    await push(rush);

    await writeFile(path.join(cwd, ".env.local"), "TOKEN=local\n", "utf8");
    await pull(pilot, true);
    await expect(readFile(path.join(cwd, ".env.local"), "utf8")).resolves.toBe("TOKEN=pilot\n");

    await pull(rush, true);
    await expect(readFile(path.join(cwd, ".env.local"), "utf8")).resolves.toBe("TOKEN=rush\n");
  });

  it("redacts diff output to keys and digests only", () => {
    const local = redactEnv("TOKEN=local-secret\nSHARED=same\n");
    const stored = redactEnv("TOKEN=stored-secret\nREMOTE=remote-secret\nSHARED=same\n");

    const output = diffText(local, stored);
    expect(output).toContain("TOKEN");
    expect(output).toContain("REMOTE");
    expect(output).not.toContain("local-secret");
    expect(output).not.toContain("stored-secret");
    expect(output).not.toContain("remote-secret");
  });

  it("supports extra env files", async () => {
    const { cwd, scope } = await fixture("pilot", [".env.local", "apps/agent-hub/.env.local"]);
    await writeFile(path.join(cwd, ".env.local"), "ROOT=1\n", "utf8");
    await writeFile(path.join(cwd, "apps/agent-hub/.env.local"), "APP=1\n", "utf8");

    const results = await push(scope);
    expect(results).toEqual([
      { file: ".env.local", action: "stored" },
      { file: "apps/agent-hub/.env.local", action: "stored" },
    ]);
  });
});

async function fixture(project: string, files = [".env.local"]) {
  const root = await tempRoot();
  const cwd = path.join(root, "project");
  const storeRoot = path.join(root, "store", project);
  const scope: ResolvedScope = { cwd, project, files, storeRoot };
  return { root, cwd, storeRoot, scope };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "env-sync-test-"));
  tempDirs.push(root);
  await writeFile(path.join(root, ".keep"), "", "utf8");
  await rm(path.join(root, ".keep"));
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path.join(root, "project", "apps", "agent-hub"), { recursive: true }));
  return root;
}
