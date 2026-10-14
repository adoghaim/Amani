/**
 * Every table that holds rows belonging to a user, and what erases them when
 * the account is deleted (PK-INT-01, owner decision D3).
 *
 * One entry per user-owned table. account-deletion-sweep.test.ts derives the
 * user-owned tables from the migrations and fails when one is missing here,
 * when an entry names a table no migration creates, or when a mechanism does
 * not hold for its table (for example `erase_reports_cascade` on a table whose
 * report foreign key is ON DELETE SET NULL).
 *
 * delete-user-data takes its ordered deletes from this list:
 * `deleteUserDataTables` (account-deletion.ts) runs the `ordered_delete`
 * entries one at a time, in the order they appear below, after erase_reports.
 *
 * Adding a user-owned table: add its entry here with the mechanism that really
 * erases it, then run `npm test`. A new `ordered_delete` goes before `users`,
 * which stays last.
 */

export const ERASURE_MECHANISMS = [
  /** Deleted when erase_reports deletes the user's lab_reports: an ON DELETE CASCADE chain from lab_reports reaches it. */
  "erase_reports_cascade",
  /** Deleted by delete-user-data itself, `DELETE ... WHERE ownerColumn = userId`, in registry order. */
  "ordered_delete",
  /** Left on purpose for the ON DELETE CASCADE from auth.users, which fires at deleteAuthUser, the last step. */
  "auth_cascade",
  /** None of the above; `reason` must say what erases it. */
  "exception",
] as const;

export type ErasureMechanism = typeof ERASURE_MECHANISMS[number];

export interface UserDataRegistryEntry {
  /**
   * Table name in the public schema: its current name, or the name its CREATE
   * TABLE gave it when a later migration renamed it (the sweep follows
   * renames). An `ordered_delete` entry must use the current name, because
   * delete-user-data deletes by it.
   */
  readonly table: string;
  /** The column that ties a row to its owner: the user id, or the report or Stripe customer it hangs off. */
  readonly ownerColumn: string;
  readonly mechanism: ErasureMechanism;
  /** Why this mechanism. Required for `exception` and `auth_cascade`. */
  readonly reason?: string;
  /**
   * `ordered_delete` only, for a table whose migration can reach production
   * after delete-user-data is deployed from main (the owner applies migrations
   * and deploys functions by hand, in separate steps). When the table does not
   * exist, delete-user-data treats it as holding nothing to erase instead of
   * failing every account deletion. Any other error on it still fails.
   * Requires a reason naming the migration that creates the table.
   */
  readonly mayBeUndeployed?: true;
}

export const USER_DATA_REGISTRY: readonly UserDataRegistryEntry[] = [
  // ── ordered_delete: run by delete-user-data in exactly this order ─────────
  { table: "interventions", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "cycle_events", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "parser_debug", ownerColumn: "user_id", mechanism: "ordered_delete" },
  {
    table: "introductory_deep_access_claims",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "Introductory Deep Access ledger. Also reachable via the CASCADE on users.id, but swept explicitly so " +
      "erasure does not depend on the order the auth identity happens to go in. erase_reports keeps claims " +
      "(report_id is ON DELETE SET NULL: erasing a report is not a refund).",
  },
  {
    table: "complimentary_entitlements",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "Complimentary grant. Also reachable via the CASCADE on users.id, but swept explicitly so erasure " +
      "does not depend on FK ordering.",
  },
  {
    table: "lab_reports",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "Root of the report graph. erase_reports has already deleted the reports it was given, in id lock " +
      "order; this user-keyed sweep runs only after that call has settled.",
  },
  { table: "period_logs", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "symptom_logs", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "notification_preferences", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "reminders", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "audit_events", ownerColumn: "user_id", mechanism: "ordered_delete" },
  { table: "rate_limits", ownerColumn: "user_id", mechanism: "ordered_delete" },
  {
    table: "iap_beta_testers",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "Sandbox-IAP beta allowlist. Unlike iap_subscriptions it is swept early: an erased beta row costs a " +
      "tester the sandbox exception and nothing else (one service-role insert restores it), while a row left " +
      "behind is a live pass for an account that no longer exists. It also cascades on auth.users.",
  },
  {
    table: "app_events",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    mayBeUndeployed: true,
    reason: "PK-EXP5 first-party usage events. Also cascades on auth.users, but swept here so the events are " +
      "gone even if the final auth deletion fails. Pre-signup rows carry an anon_id and no user_id; nothing " +
      "links them to an account. mayBeUndeployed: created by 20261015010000_first_party_events.sql, which can " +
      "reach production after delete-user-data is deployed from main; until then there is nothing to erase.",
  },
  {
    table: "user_attribution",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    mayBeUndeployed: true,
    reason: "PK-EXP5 first-touch signup attribution, one row per user. Also cascades on auth.users, but swept " +
      "here so it is gone even if the final auth deletion fails. mayBeUndeployed: created by " +
      "20261015010000_first_party_events.sql, which can reach production after delete-user-data is deployed " +
      "from main; until then there is nothing to erase.",
  },
  {
    table: "users",
    ownerColumn: "id",
    mechanism: "ordered_delete",
    reason: "The user's profile row itself, deleted by id. Kept last so the cleanups above can still reference " +
      "the id if any FK were to require it.",
  },

  // ── erase_reports_cascade: gone with the user's lab_reports ──────────────
  { table: "biomarkers", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "report_items", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "report_analytes", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "lab_results", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "derived_metric_results", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "insight_rule_results", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "health_scores", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  {
    table: "interpretations",
    ownerColumn: "lab_report_id",
    mechanism: "erase_reports_cascade",
    reason: "Registered under the name its CREATE TABLE gave it. 20260926000001 renamed the table, and application " +
      "code may not name the raw table (TASK-047 M8c, legacy-raw-access.test.ts); the sweep follows the rename. " +
      "The interpretations name now belongs to the compatibility view. The lab_reports cascade carried over.",
  },
  { table: "interpretation_versions", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  { table: "interpretation_current_versions", ownerColumn: "lab_report_id", mechanism: "erase_reports_cascade" },
  {
    table: "interpretation_history_protection",
    ownerColumn: "lab_report_id",
    mechanism: "erase_reports_cascade",
    reason: "Cascades through the renamed interpretations table, on (id, lab_report_id).",
  },

  // ── auth_cascade ──────────────────────────────────────────────────────────
  /*
    From delete-user-data (V2), where this comment sat under the table list:

    `iap_subscriptions` is deliberately absent from the list above.

    Every table listed there also has ON DELETE CASCADE on auth.users;
    they are deleted explicitly anyway so that a user's *health data* is
    gone even if the final auth deletion fails. That reasoning does not
    transfer to entitlement rows: deleting them early and then failing at
    deleteAuthUser would leave a live account with its subscription record
    erased — a paying customer locked out of what they bought, by the
    cleanup meant to help them.

    So it rides the cascade instead (see
    20260821000000_add_iap_subscriptions.sql:26 — user_id REFERENCES
    auth.users(id) ON DELETE CASCADE), which fires at the one moment the
    account genuinely ceases to exist.

    `iap_beta_testers` IS in the list above, and the difference is what
    the row would cost if deletion then failed halfway. An erased
    `iap_subscriptions` row locks a paying customer out of something they
    bought. An erased beta row costs a tester the sandbox exception and
    nothing else — they still have their trial and any real purchase — and
    it is one service-role insert to restore. Meanwhile leaving it behind
    is the worse outcome of the two: a live pass for an account that no
    longer exists, which is exactly the "beta pass that outlives the beta"
    the table's own comment warns about. It also cascades on
    auth.users, so the explicit delete is belt-and-braces rather than the
    only mechanism.
  */
  {
    table: "iap_subscriptions",
    ownerColumn: "user_id",
    mechanism: "auth_cascade",
    reason: "Deliberately not deleted early: deleting it and then failing at deleteAuthUser would leave a live " +
      "account with its subscription record erased, a paying customer locked out of what they bought. It " +
      "rides user_id REFERENCES auth.users(id) ON DELETE CASCADE (20260821000000_add_iap_subscriptions.sql), " +
      "which fires at the one moment the account ceases to exist.",
  },

  // ── exception ─────────────────────────────────────────────────────────────
  {
    table: "stripe_customers",
    ownerColumn: "user_id",
    mechanism: "exception",
    reason: "Deleted by the Stripe step (deleteLocalStripeRecords, by user_id), which runs when " +
      "getStripeCustomerId returns a customer; it reads this row first. user_id references auth.users without " +
      "ON DELETE CASCADE, so a row left behind makes deleteAuthUser fail rather than outlive the account.",
  },
  {
    table: "stripe_subscriptions",
    ownerColumn: "customer_id",
    mechanism: "exception",
    reason: "Keyed by Stripe customer_id, not user_id. Deleted by the Stripe step (deleteLocalStripeRecords) for " +
      "the customer getStripeCustomerId finds (stripe_customers, else the legacy users.stripe_customer_id).",
  },
  {
    table: "stripe_orders",
    ownerColumn: "customer_id",
    mechanism: "exception",
    reason: "Keyed by Stripe customer_id, not user_id. Deleted by the Stripe step (deleteLocalStripeRecords) for " +
      "the customer getStripeCustomerId finds (stripe_customers, else the legacy users.stripe_customer_id).",
  },
  {
    table: "interpretation_generation_costs",
    ownerColumn: "user_id",
    mechanism: "exception",
    reason: "Operational cost telemetry, not swept by user_id: user_id REFERENCES public.users(id) ON DELETE " +
      "CASCADE removes it when the users profile row (the last ordered delete) goes. report_id is ON DELETE " +
      "SET NULL, so erase_reports leaves it until then.",
  },
  {
    table: "ai_call_costs",
    ownerColumn: "user_id",
    mechanism: "exception",
    reason: "PK-FIX-01b AI cost ledger: function name, model, token counts and an estimated cost, no health data. " +
      "Not swept, so the monthly spend the budget alert sums survives: user_id REFERENCES auth.users(id) ON " +
      "DELETE SET NULL (20261013050000_ai_cost_ledger.sql), so deleteAuthUser, the last step, nulls the user id " +
      "and the rows are no longer the user's.",
  },
];

/** The `ordered_delete` entries, in the order delete-user-data runs them. */
export function orderedDeletes(
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): UserDataRegistryEntry[] {
  return registry.filter((entry) => entry.mechanism === "ordered_delete");
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * What is wrong with the registry on its own terms: names, duplicates, unknown
 * mechanisms, an exception without a reason, or the profile row not last.
 * Whether each entry is true of the schema is the sweep test's job.
 */
export function registryProblems(
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of registry) {
    if (!IDENTIFIER.test(entry.table)) problems.push(`"${entry.table}" is not a table name`);
    if (!IDENTIFIER.test(entry.ownerColumn)) problems.push(`${entry.table}: "${entry.ownerColumn}" is not a column name`);
    if (seen.has(entry.table)) problems.push(`${entry.table} is registered more than once`);
    seen.add(entry.table);
    if (!(ERASURE_MECHANISMS as readonly string[]).includes(entry.mechanism)) {
      problems.push(`${entry.table}: unknown mechanism "${entry.mechanism}"`);
    }
    if (entry.mechanism === "exception" && !entry.reason?.trim()) {
      problems.push(`${entry.table}: an exception needs a reason saying what erases it`);
    }
    if (entry.mayBeUndeployed && entry.mechanism !== "ordered_delete") {
      problems.push(`${entry.table}: mayBeUndeployed only applies to an ordered delete`);
    }
    if (entry.mayBeUndeployed && entry.table === "users") {
      problems.push("users: the profile row can never be treated as undeployed");
    }
    if (entry.mayBeUndeployed && !entry.reason?.trim()) {
      problems.push(`${entry.table}: mayBeUndeployed needs a reason naming the migration that creates it`);
    }
    if (entry.mechanism === "auth_cascade" && !entry.reason?.trim()) {
      problems.push(`${entry.table}: leaving rows to the auth.users cascade needs a reason`);
    }
  }
  const ordered = orderedDeletes(registry);
  const last = ordered[ordered.length - 1];
  if (!last || last.table !== "users" || last.ownerColumn !== "id") {
    problems.push("the users profile row (by id) must be the last ordered delete");
  }
  return problems;
}
