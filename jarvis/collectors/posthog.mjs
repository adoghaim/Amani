#!/usr/bin/env node
// PostHog: product analytics (signups, activation, funnel, retention, premium conversion),
// experiments and feature flags. Read-only: only GET requests and POST /query/ (HogQL SELECT).
// Docs: https://posthog.com/docs/api/queries  https://posthog.com/docs/experiments/surfaces/api
import { missing, skip, run, fetchJson, settle } from "./lib.mjs";

const SRC = "posthog";
const need = missing("POSTHOG_HOST", "POSTHOG_PROJECT_ID", "POSTHOG_PERSONAL_API_KEY");
if (need.length) skip(SRC, need);

const host = process.env.POSTHOG_HOST.replace(/\/+$/, "");
const pid = encodeURIComponent(process.env.POSTHOG_PROJECT_ID);
const headers = {
  Authorization: `Bearer ${process.env.POSTHOG_PERSONAL_API_KEY}`,
  "Content-Type": "application/json",
};

// Event names are configurable because Amani's instrumentation plan is not fixed yet.
const safe = (s, d) => {
  const v = (s || d).trim();
  if (!/^[A-Za-z0-9_$ .:\-]+$/.test(v)) throw new Error(`Unsafe event name in env: ${v}`);
  return v.replace(/'/g, "");
};
const EV_SIGNUP = safe(process.env.POSTHOG_SIGNUP_EVENT, "user_signed_up");
const EV_ACTIVATION = safe(process.env.POSTHOG_ACTIVATION_EVENT, "lab_report_uploaded");
const EV_PREMIUM = safe(process.env.POSTHOG_PREMIUM_EVENT, "subscription_started");

async function hogql(query) {
  const body = JSON.stringify({ query: { kind: "HogQLQuery", query }, name: "jarvis-daily" });
  const r = await fetchJson(`${host}/api/projects/${pid}/query/`, { method: "POST", headers, body }, 60000);
  return { columns: r.columns, rows: r.results };
}

await run(SRC, async () => {
  const results = await settle({
    event_names_used: async () => ({ signup: EV_SIGNUP, activation: EV_ACTIVATION, premium: EV_PREMIUM }),
    top_events_7d: () => hogql(
      `SELECT event, count() AS n FROM events WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY event ORDER BY n DESC LIMIT 40`),
    active_users: () => hogql(
      `SELECT uniqIf(person_id, timestamp > now() - INTERVAL 1 DAY) AS dau,
              uniqIf(person_id, timestamp > now() - INTERVAL 7 DAY) AS wau,
              uniq(person_id) AS mau
       FROM events WHERE timestamp > now() - INTERVAL 30 DAY`),
    daily_signups_14d: () => hogql(
      `SELECT toDate(timestamp) AS day, uniq(person_id) AS signups FROM events
       WHERE event = '${EV_SIGNUP}' AND timestamp > now() - INTERVAL 14 DAY GROUP BY day ORDER BY day`),
    daily_activations_14d: () => hogql(
      `SELECT toDate(timestamp) AS day, uniq(person_id) AS activated FROM events
       WHERE event = '${EV_ACTIVATION}' AND timestamp > now() - INTERVAL 14 DAY GROUP BY day ORDER BY day`),
    // Funnel for people who signed up in the last 30 days: signup -> activation (<=7d) -> premium (<=30d).
    funnel_30d_cohort: () => hogql(
      `SELECT count() AS signups,
              countIf(a.t > toDateTime('2001-01-01') AND a.t <= s.t + INTERVAL 7 DAY) AS activated_within_7d,
              countIf(p.t > toDateTime('2001-01-01') AND p.t <= s.t + INTERVAL 30 DAY) AS premium_within_30d
       FROM (SELECT person_id, min(timestamp) AS t FROM events
             WHERE event = '${EV_SIGNUP}' AND timestamp > now() - INTERVAL 30 DAY GROUP BY person_id) AS s
       LEFT JOIN (SELECT person_id, min(timestamp) AS t FROM events
             WHERE event = '${EV_ACTIVATION}' AND timestamp > now() - INTERVAL 37 DAY GROUP BY person_id) AS a
         ON s.person_id = a.person_id
       LEFT JOIN (SELECT person_id, min(timestamp) AS t FROM events
             WHERE event = '${EV_PREMIUM}' AND timestamp > now() - INTERVAL 60 DAY GROUP BY person_id) AS p
         ON s.person_id = p.person_id`),
    // Simple retention proxy: people who signed up 14-28 days ago and did anything in the last 7 days.
    retention_proxy: () => hogql(
      `SELECT count() AS cohort_size, countIf(r.n > 0) AS active_last_7d
       FROM (SELECT person_id FROM events WHERE event = '${EV_SIGNUP}'
             AND timestamp BETWEEN now() - INTERVAL 28 DAY AND now() - INTERVAL 14 DAY GROUP BY person_id) AS c
       LEFT JOIN (SELECT person_id, count() AS n FROM events
             WHERE timestamp > now() - INTERVAL 7 DAY GROUP BY person_id) AS r
         ON c.person_id = r.person_id`),
    experiments: async () => {
      const r = await fetchJson(`${host}/api/projects/${pid}/experiments/?limit=50`, { headers });
      return (r.results || []).map((e) => ({
        id: e.id, name: e.name, description: e.description, feature_flag_key: e.feature_flag_key,
        start_date: e.start_date, end_date: e.end_date, archived: e.archived, type: e.type,
        variants: e.parameters?.feature_flag_variants, created_at: e.created_at,
      }));
    },
    feature_flags: async () => {
      const r = await fetchJson(`${host}/api/projects/${pid}/feature_flags/?limit=100`, { headers });
      return (r.results || []).filter((f) => !f.deleted).map((f) => ({
        id: f.id, key: f.key, name: f.name, active: f.active,
        rollout_groups: (f.filters?.groups || []).map((g) => ({ rollout: g.rollout_percentage, conditions: (g.properties || []).length })),
        variants: f.filters?.multivariate?.variants?.map((v) => `${v.key}:${v.rollout_percentage}%`),
        experiment_set: f.experiment_set, updated_at: f.updated_at ?? f.created_at,
      }));
    },
  });
  results.notes = [
    "Event names are configured via POSTHOG_*_EVENT. If top_events_7d does not contain them, the funnel numbers are zero because of naming, not because of users.",
    "Experiment statistical results are not pulled here; use the PostHog MCP (read-only) for experiment results.",
  ];
  return results;
});
