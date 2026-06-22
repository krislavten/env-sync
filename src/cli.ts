#!/usr/bin/env node
import { CONFIG_FILE, diffText, initConfig, pull, push, resolveScope, status } from "./index.js";

type ParsedArgs = {
  command?: string;
  project?: string;
  files: string[];
  force: boolean;
  help: boolean;
};

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || !args.command) {
    printHelp();
    return args.command ? 0 : 1;
  }

  if (args.command === "init") {
    const result = await initConfig({ cwd: process.cwd(), project: args.project, files: args.files });
    console.log(`created ${CONFIG_FILE}`);
    console.log(`project: ${result.config.project}`);
    console.log(`files: ${result.config.files.join(", ")}`);
    return 0;
  }

  const scope = await resolveScope({ cwd: process.cwd(), project: args.project, files: args.files });
  if (args.command === "push") {
    const results = await push(scope);
    for (const result of results) {
      console.log(`${result.file}: ${result.action}`);
    }
    return results.some((result) => result.action === "missing-local") ? 2 : 0;
  }

  if (args.command === "pull") {
    const results = await pull(scope, args.force);
    for (const result of results) {
      console.log(`${result.file}: ${result.action}`);
    }
    return results.some((result) => result.action === "blocked-different" || result.action === "missing-store") ? 2 : 0;
  }

  if (args.command === "status" || args.command === "diff") {
    const entries = await status(scope);
    for (const entry of entries) {
      console.log(`${entry.file}: ${entry.state}`);
      if (args.command === "diff") {
        const text = diffText(entry.localKeys, entry.storedKeys);
        console.log(text ? indent(text) : "  no key changes");
      }
    }
    return entries.some((entry) => entry.state === "different" || entry.state.startsWith("missing")) ? 1 : 0;
  }

  throw new Error(`unknown command: ${args.command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = { files: [], force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--force") {
      parsed.force = true;
      continue;
    }
    if (arg === "--file" || arg === "-f") {
      const file = argv[index + 1];
      if (!file) {
        throw new Error(`${arg} requires a path`);
      }
      parsed.files.push(file);
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
    if (!parsed.command) {
      parsed.command = arg;
      continue;
    }
    if (!parsed.project) {
      parsed.project = arg;
      continue;
    }
    throw new Error(`unexpected argument: ${arg}`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`env-sync

Usage:
  env-sync init <project> [--file <path>...]
  env-sync push <project> [--file <path>...]
  env-sync pull <project> [--file <path>...] [--force]
  env-sync status [project] [--file <path>...]
  env-sync diff [project] [--file <path>...]
`);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
