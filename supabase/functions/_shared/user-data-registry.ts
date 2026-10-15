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
 *
 * DEPLOY ORDER (PK-HARM-01 review). delete-user-data deletes from every
 * `ordered_delete` table and fails closed on any error, so a delete-user-data
 * built from a commit that carries an entry must not be deployed before the
 * migration that creates its table is pushed: otherwise every account deletion
 * fails. An `ordered_delete` table created after the V2 backend runbook
 * (V2_RUNBOOK_LAST_MIGRATION) names that migration in `requiresMigration`
 * (account-deletion-sweep.test.ts enforces it). Before any delete-user-data
 * deploy the owner runs factory/sql/verify-account-deletion-tables.sql (the
 * text of deletionPreflightSql() below): zero rows means every table exists.
 * The function also checks this itself before deleting anything
 * (checkUserDataTablesReady in account-deletion.ts: one GET per table that
 * must return a rows array, never a HEAD, which supabase-js reads as success
 * for a missing table) and refuses with 503. The preflight SQL is the check to
 * rely on; the runtime check is the backstop.
 */

/**
 * The newest migration the V2 backend runbook (PR #93) pushes. A table an
 * `ordered_delete` entry names that a later migration creates must declare
 * `requiresMigration`.
 */
export const V2_RUNBOOK_LAST_MIGRATION = "20261011000003";

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
  /**
   * The version of the migration that creates this table, when that migration
   * is newer than V2_RUNBOOK_LAST_MIGRATION. It must be pushed to a database
   * before a delete-user-data that carries this entry is deployed against it.
   */
  readonly requiresMigration?: string;
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
    table: "interpretation_feedback",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "PK-HARM-01 problem reports, which may hold her free text. Also reachable via the CASCADEs on " +
      "lab_reports (report_id) and auth.users (user_id), but swept explicitly by user_id so no row depends on " +
      "the order the report graph or the auth identity goes in. DEPLOY ORDER: never deploy delete-user-data " +
      "built from this entry's commit or later until migration 20261015020000 is pushed; until then the " +
      "function's readiness check refuses every deletion (503) rather than deleting part of an account.",
    requiresMigration: "20261015020000",
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
    table: "consent_records",
    ownerColumn: "user_id",
    mechanism: "ordered_delete",
    reason: "PK-CONSENT-01 consent ledger. Append-only, but its guard lets service_role delete (this sweep) and " +
      "the auth.users ON DELETE CASCADE through, so erasure removes it; also reachable via that cascade.",
    requiresMigration: "20261015040000",
  },
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
    requiresMigration: "20261015010000",
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
    requiresMigration: "20261015010000",
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

/** One table delete-user-data will delete from, and the migration that must be pushed first, if any. */
export interface DeletionDeployPrerequisite {
  readonly table: string;
  readonly requiresMigration: string | null;
}

/** Every table delete-user-data deletes from, in registry order. */
export function deletionDeployPrerequisites(
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): DeletionDeployPrerequisite[] {
  return orderedDeletes(registry).map((entry) => ({
    table: entry.table,
    requiresMigration: entry.requiresMigration ?? null,
  }));
}

/**
 * A read-only query the owner runs in the SQL editor of the database a
 * delete-user-data deploy will serve, before deploying it. Each row is a table
 * the function deletes from that does not exist there, with the migration to
 * push first. Zero rows: safe to deploy. factory/sql/verify-account-deletion-tables.sql
 * holds this text (a test keeps them identical).
 */
export function deletionPreflightSql(
  registry: readonly UserDataRegistryEntry[] = USER_DATA_REGISTRY,
): string {
  const rows = deletionDeployPrerequisites(registry).map(({ table, requiresMigration }, i) => {
    if (!IDENTIFIER.test(table)) throw new Error(`"${table}" is not a table name`);
    if (requiresMigration !== null && !MIGRATION_VERSION.test(requiresMigration)) {
      throw new Error(`${table}: "${requiresMigration}" is not a migration version`);
    }
    const migration = requiresMigration === null ? "null::text" : `'${requiresMigration}'::text`;
    return `  (${i + 1}, '${table}'::text, ${migration})`;
  });
  return [
    "-- Account deletion deploy preflight (generated from supabase/functions/_shared/user-data-registry.ts",
    "-- by deletionPreflightSql(); a test keeps this file identical to it).",
    "--",
    "-- Read-only. Run it in the SQL editor of the project a delete-user-data deploy will serve, BEFORE",
    "-- `supabase functions deploy delete-user-data`. Each row is a table the function deletes from that does",
    "-- not exist there, and the migration that creates it. Zero rows: every table exists; safe to deploy.",
    "-- Any row: push that migration first. Deployed early, the function refuses every account deletion.",
    "select t.table_name, t.required_migration",
    "from (values",
    rows.join(",\n"),
    ") as t(ord, table_name, required_migration)",
    "where to_regclass(format('public.%I', t.table_name)) is null",
    "order by t.ord;",
    "",
  ].join("\n");
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const MIGRATION_VERSION = /^\d{14}$/;

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
    if (entry.requiresMigration !== undefined && !MIGRATION_VERSION.test(entry.requiresMigration)) {
      problems.push(`${entry.table}: requiresMigration "${entry.requiresMigration}" is not a migration version`);
    }
    if (entry.requiresMigration !== undefined && entry.mechanism !== "ordered_delete") {
      problems.push(`${entry.table}: requiresMigration only applies to an ordered delete`);
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
