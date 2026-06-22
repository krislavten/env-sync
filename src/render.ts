import type { RedactedEnvEntry } from "./core.js";

export function diffText(localKeys: RedactedEnvEntry[], storedKeys: RedactedEnvEntry[]): string {
  const local = new Map(localKeys.map((entry) => [entry.key, entry.digest]));
  const stored = new Map(storedKeys.map((entry) => [entry.key, entry.digest]));
  const keys = [...new Set([...local.keys(), ...stored.keys()])].sort();
  const lines: string[] = [];

  for (const key of keys) {
    const localDigest = local.get(key);
    const storedDigest = stored.get(key);
    if (localDigest === undefined) {
      lines.push(`+ ${key} stored:${storedDigest}`);
    } else if (storedDigest === undefined) {
      lines.push(`- ${key} local:${localDigest}`);
    } else if (localDigest !== storedDigest) {
      lines.push(`~ ${key} local:${localDigest} stored:${storedDigest}`);
    }
  }

  return lines.join("\n");
}
