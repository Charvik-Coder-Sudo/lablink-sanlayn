let envLoaded = false;

export function ensureSupabaseEnvLoaded(): void {
  if (envLoaded || typeof window !== "undefined") return;

  if (typeof process === "undefined" || !process.env || !process.versions?.node) {
    envLoaded = true;
    return;
  }

  const loadEnvFile = (process as typeof process & { loadEnvFile?: (path: string) => void }).loadEnvFile;

  if (typeof loadEnvFile === "function") {
    for (const candidate of [".env.local", ".env"]) {
      try {
        loadEnvFile(`${process.cwd()}/${candidate}`);
      } catch {
        // Ignore file read errors and fall back to existing process env.
      }
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
