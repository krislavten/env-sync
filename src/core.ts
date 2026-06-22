import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const CONFIG_FILE = ".env-sync.json";
export const DEFAULT_ENV_FILE = ".env.local";

export type EnvSyncConfig = {
  project?: string;
  files?: string[];
};

export type ResolveOptions = {
  cwd: string;
  project?: string;
  files?: string[];
};

export type ResolvedScope = {
  cwd: string;
  project: string;
  files: string[];
  storeRoot: string;
};

export type FileState = "missing-both" | "missing-local" | "missing-store" | "same" | "different";

export type StatusEntry = {
  file: string;
  state: FileState;
  localKeys: RedactedEnvEntry[];
  storedKeys: RedactedEnvEntry[];
};

export type RedactedEnvEntry = {
  key: string;
  digest: string;
};

export type PullResult = {
  file: string;
  action: "created" | "updated" | "skipped-same" | "blocked-different" | "missing-store";
};

export type PushResult = {
  file: string;
  action: "stored" | "missing-local";
};

export type InitResult = {
  path: string;
  config: Required<EnvSyncConfig>;
};

export async function initConfig(options: ResolveOptions): Promise<InitResult> {
  const project = requireProject(options.project);
  const files = uniqueFiles(options.files?.length ? options.files : [DEFAULT_ENV_FILE]);
  const config: Required<EnvSyncConfig> = { project, files };
  const configPath = path.join(options.cwd, CONFIG_FILE);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { path: configPath, config };
}

export async function push(scope: ResolvedScope): Promise<PushResult[]> {
  const results: PushResult[] = [];
  for (const file of scope.files) {
    const localPath = localFilePath(scope.cwd, file);
    const local = await readTextIfExists(localPath);
    if (local === undefined) {
      results.push({ file, action: "missing-local" });
      continue;
    }

    const storedPath = storedFilePath(scope, file);
    await mkdir(path.dirname(storedPath), { recursive: true, mode: 0o700 });
    await writeFile(storedPath, local, { encoding: "utf8", mode: 0o600 });
    results.push({ file, action: "stored" });
  }
  return results;
}

export async function pull(scope: ResolvedScope, force = false): Promise<PullResult[]> {
  const results: PullResult[] = [];
  for (const file of scope.files) {
    const stored = await readTextIfExists(storedFilePath(scope, file));
    if (stored === undefined) {
      results.push({ file, action: "missing-store" });
      continue;
    }

    const localPath = localFilePath(scope.cwd, file);
    const local = await readTextIfExists(localPath);
    if (local === stored) {
      results.push({ file, action: "skipped-same" });
      continue;
    }
    if (local !== undefined && !force) {
      results.push({ file, action: "blocked-different" });
      continue;
    }

    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, stored, { encoding: "utf8", mode: 0o600 });
    results.push({ file, action: local === undefined ? "created" : "updated" });
  }
  return results;
}

export async function status(scope: ResolvedScope): Promise<StatusEntry[]> {
  const results: StatusEntry[] = [];
  for (const file of scope.files) {
    const local = await readTextIfExists(localFilePath(scope.cwd, file));
    const stored = await readTextIfExists(storedFilePath(scope, file));
    results.push({
      file,
      state: fileState(local, stored),
      localKeys: redactEnv(local),
      storedKeys: redactEnv(stored),
    });
  }
  return results;
}

export async function resolveScope(options: ResolveOptions): Promise<ResolvedScope> {
  const config = await readConfig(options.cwd);
  const project = options.project ?? config.project;
  const files = options.files?.length ? options.files : config.files?.length ? config.files : [DEFAULT_ENV_FILE];

  return {
    cwd: options.cwd,
    project: requireProject(project),
    files: uniqueFiles(files),
    storeRoot: projectStoreRoot(requireProject(project)),
  };
}

export async function readConfig(cwd: string): Promise<EnvSyncConfig> {
  const configPath = path.join(cwd, CONFIG_FILE);
  const raw = await readTextIfExists(configPath);
  if (raw === undefined) {
    return {};
  }

  const parsed = JSON.parse(raw) as EnvSyncConfig;
  if (parsed.project !== undefined && typeof parsed.project !== "string") {
    throw new Error(`${CONFIG_FILE}: project must be a string`);
  }
  if (parsed.files !== undefined && !Array.isArray(parsed.files)) {
    throw new Error(`${CONFIG_FILE}: files must be an array`);
  }
  return parsed;
}

export function projectStoreRoot(project: string): string {
  return path.join(homedir(), ".env-sync", safeProjectName(project));
}

export function storedFilePath(scope: ResolvedScope, file: string): string {
  return path.join(scope.storeRoot, "files", safeRelativePath(file));
}

export function localFilePath(cwd: string, file: string): string {
  const resolved = path.resolve(cwd, file);
  const relative = path.relative(cwd, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`file path must stay inside the current directory: ${file}`);
  }
  return resolved;
}

export function redactEnv(content: string | undefined): RedactedEnvEntry[] {
  if (content === undefined) {
    return [];
  }

  const entries = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trimStart() : line;
    const equalsIndex = normalized.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = normalized.slice(0, equalsIndex).trim();
    const value = normalized.slice(equalsIndex + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    entries.set(key, shortDigest(value));
  }

  return [...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, digest]) => ({ key, digest }));
}

function fileState(local: string | undefined, stored: string | undefined): FileState {
  if (local === undefined && stored === undefined) {
    return "missing-both";
  }
  if (local === undefined) {
    return "missing-local";
  }
  if (stored === undefined) {
    return "missing-store";
  }
  return local === stored ? "same" : "different";
}

function safeProjectName(project: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project)) {
    throw new Error("project must contain only letters, numbers, dot, underscore, or dash");
  }
  return project;
}

function safeRelativePath(file: string): string {
  if (!file || path.isAbsolute(file)) {
    throw new Error(`file path must be relative: ${file}`);
  }
  const normalized = path.normalize(file);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`file path must stay inside the current directory: ${file}`);
  }
  return normalized;
}

function requireProject(project: string | undefined): string {
  if (!project) {
    throw new Error(`project is required. Pass it explicitly or run env-sync init <project>`);
  }
  return safeProjectName(project);
}

function uniqueFiles(files: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const file of files) {
    const safe = safeRelativePath(file);
    if (!seen.has(safe)) {
      seen.add(safe);
      unique.push(safe);
    }
  }
  return unique;
}

async function readTextIfExists(file: string): Promise<string | undefined> {
  try {
    await stat(file);
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
