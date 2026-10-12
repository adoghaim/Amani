/*
  Per-tap identity of a regeneration (TASK-048). Once a report holds an
  interpretation, generate-interpretation appends a new version instead of
  overwriting it, keyed by this id: a retry of the same tap re-sends the same id,
  so a request the server already committed is answered without a second
  version. A new tap is a new id. Only success settles the tap; after any failure
  the retry keeps the id, which is harmless when nothing was committed.
*/
export interface RegenerationRequests {
  /** The id to send: the pending one when retrying, otherwise a fresh one. */
  next(retry: boolean): string;
  /** The tap succeeded; the next request is a new one. */
  settle(): void;
}

export function createRegenerationRequests(newId: () => string = () => crypto.randomUUID()): RegenerationRequests {
  let pending: string | null = null;
  return {
    next(retry) {
      if (!retry || pending === null) pending = newId();
      return pending;
    },
    settle() {
      pending = null;
    },
  };
}
