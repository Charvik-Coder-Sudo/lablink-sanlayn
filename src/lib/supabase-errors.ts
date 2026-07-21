export interface SupabaseErrorInfo {
  code: string | null;
  message: string;
  details: string | null;
  hint: string | null;
}

/**
 * PostgrestError/StorageError from supabase-js are plain objects, not Error instances,
 * so `instanceof Error` silently fails and discards code/details/hint. Read the fields
 * directly instead.
 */
export function extractSupabaseError(err: unknown): SupabaseErrorInfo {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    return {
      code: typeof e.code === "string" ? e.code : null,
      message: typeof e.message === "string" ? e.message : JSON.stringify(err),
      details: typeof e.details === "string" ? e.details : null,
      hint: typeof e.hint === "string" ? e.hint : null,
    };
  }
  return { code: null, message: String(err), details: null, hint: null };
}
