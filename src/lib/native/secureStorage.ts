// ─── Secure storage stub ──────────────────────────────────────────────────

/**
 * Thin abstraction over storage that is ready to swap to a secure-storage
 * implementation (e.g. @ionic-enterprise/identity-vault) without touching
 * call sites.
 *
 * For Phase 4, this delegates to localStorage (same as Supabase's default).
 * A future phase can replace the implementation here to use the secure enclave.
 */
export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  },
};
