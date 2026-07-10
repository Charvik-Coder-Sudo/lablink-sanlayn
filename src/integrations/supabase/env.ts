import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let envLoaded = false;

function parseEnvFile(content: string): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

export function ensureSupabaseEnvLoaded(): void {
  if (envLoaded || typeof window !== "undefined") return;

  if (typeof process === "undefined" || !process.env || !process.versions?.node) {
    envLoaded = true;
    return;
  }

  const cwd = process.cwd();
  const candidates = [".env.local", ".env"];

  for (const candidate of candidates) {
    const filePath = resolve(cwd, candidate);
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, "utf8");
      const parsed = parseEnvFile(content);
      for (const [key, value] of Object.entries(parsed)) {
        if (value && process.env[key] == null) {
          process.env[key] = value;
        }
      }
    } catch {
      // Ignore file read errors and fall back to existing process env.
    }
  }

  envLoaded = true;
}

export function getSupabaseEnvVar(name: string): string | undefined {
  ensureSupabaseEnvLoaded();

  const viteKey = `VITE_${name}`;

  if (typeof import.meta !== "undefined" && import.meta.env) {
    if (import.meta.env[viteKey]) return import.meta.env[viteKey] as string;
    if (import.meta.env[name]) return import.meta.env[name] as string;
  }

  if (typeof process !== "undefined" && process.env) {
    if (process.env[viteKey]) return process.env[viteKey];
    if (process.env[name]) return process.env[name];

    const nextKey = `NEXT_PUBLIC_${name}`;
    if (process.env[nextKey]) return process.env[nextKey];
  }

  return undefined;
}
