import type { SupabaseClient } from "npm:@supabase/supabase-js@2.105.3";
import type { RateLimitStore } from "./rate-limit.ts";

/**
 * PostgREST-backed counter for `enforceRateLimit`. The whole policy lives in
 * `rate-limit.ts`; this is the one query it needs.
 *
 * `increment_rate_limit` is an INSERT ... ON CONFLICT DO UPDATE that returns the
 * post-increment count (migration 20260823010000_atomic_rate_limits.sql), so
 * concurrent requests serialize on the unique index instead of racing through a
 * read-then-write. It is granted to `service_role` only — pass the service-role
 * client, not the caller's.
 */
export function createRateLimitStore(supabase: SupabaseClient): RateLimitStore {
  return {
    async incrementAndGet({ userId, endpoint, windowStart }) {
      const { data, error } = await supabase.rpc("increment_rate_limit", {
        p_user_id: userId,
        p_endpoint: endpoint,
        p_window_start: windowStart,
      });

      if (error) {
        return { data: null, error };
      }

      return { data: typeof data === "number" ? data : null, error: null };
    },
  };
}
