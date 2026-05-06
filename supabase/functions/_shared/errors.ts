// Deno mirror of src/lib/errors.ts. Kept as a parallel file rather than
// imported across runtimes because edge functions cannot reach into src/.

export function errorMessage(e: unknown, fallback = "Unknown error"): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return fallback;
}
