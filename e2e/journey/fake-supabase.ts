import { randomUUID } from 'node:crypto';
import type { Database } from '../../src/types/supabase.generated';
import { TABLE_COLUMNS } from './schema-columns';
import type { Route } from '@playwright/test';

/*
  PK-03e-I: a deterministic, stateful stand-in for the Supabase HTTP surface the
  web client calls (GoTrue auth, PostgREST, Storage, Edge Functions). It exists
  because there is no local Supabase stack and no test project; it is NOT the
  server. It holds rows in memory and answers each request in the wire shape
  supabase-js expects, and mirrors only the boundaries the client depends on:

  - every REST read and write is scoped to the bearer token's user, as RLS does
    (owned tables by user_id/id, child tables through lab_reports ownership);
  - storage writes must sit under the caller's own `<user id>/` prefix, as the
    lab-files bucket policy requires;
  - a request this stand-in does not model is recorded as unexpected and
    aborted, so a new or changed client call fails the test instead of being
    answered by a guess.

  The Edge Function answers are computed by server-model.ts from the real
  supabase/functions/_shared modules, not authored here.
*/

export const API_ORIGIN = 'https://amani-e2e.invalid';
export type Row = Record<string, unknown>;
// Sparse in-memory projections; every known column and its value type comes
// from generated Row, including literals seeded directly by server-model.
type Tables = Database['public']['Tables'];
// Generated users Row predates these base migrations; isolate the exact drift.
// 20260502000000_add_onboarding_fields_to_users.sql and
// 20260519000000_add_full_name_to_users.sql (no invented columns).
type ProfileRow = Omit<Tables['users']['Row'], 'trial_start_date'> & {
  trial_start_date: string | null; full_name: string | null;
  onboarding_completed: boolean; onboarding_skipped: boolean;
  health_goals: string[]; symptoms: string[]; supplements: string[]; known_conditions: string[];
  sex_at_birth: string | null; pregnancy_status: string | null;
};
type KnownTables = { -readonly [T in keyof typeof TABLE_COLUMNS]: Partial<T extends 'users' ? ProfileRow : Tables[T]['Row']>[] };
type ModelledTables = KnownTables & Record<string, Row[]>;

/** Tables owned directly by `user_id` (RLS `user_id = auth.uid()`). */
const USER_TABLES = new Set([
  'lab_reports', 'period_logs', 'symptom_logs', 'interventions', 'iap_subscriptions', 'iap_beta_testers',
  'complimentary_entitlements', 'notification_preferences', 'introductory_deep_access_claims',
  'cycle_events', 'parser_debug', 'interpretation_feedback', 'reminders', 'audit_events',
  'rate_limits', 'consent_records', 'app_events', 'user_attribution',
]);
/** Tables owned through `lab_report_id` (RLS joins lab_reports). */
const REPORT_TABLES = new Set(['biomarkers', 'report_analytes']);
/** Public reference data. */
const PUBLIC_TABLES = new Set(['canonical_analytes', 'biomarker_catalog', 'app_public_config']);

const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export interface AuthUser { id: string; email: string; password: string; created_at: string }

export class FakeSupabase {
  readonly authUsers = new Map<string, AuthUser>();
  readonly tables: ModelledTables = {
    users: [], lab_reports: [], biomarkers: [], report_analytes: [], period_logs: [], symptom_logs: [],
    interventions: [], iap_subscriptions: [], iap_beta_testers: [], complimentary_entitlements: [],
    notification_preferences: [], introductory_deep_access_claims: [], stripe_subscriptions: [], stripe_customers: [], stripe_orders: [],
    report_items: [], lab_results: [], derived_metric_results: [], insight_rule_results: [], health_scores: [],
    cycle_events: [], parser_debug: [], interpretation_feedback: [], reminders: [], audit_events: [],
    rate_limits: [], consent_records: [], app_events: [], user_attribution: [],
    app_public_config: [
      ...['min_version_ios', 'min_version_android', 'latest_version_ios', 'latest_version_android'].map(key => ({ key, value: null })),
      { key: 'features', value: {} },
    ],
    // Reference catalog: empty here; the client falls back to its bundled registry.
    biomarker_catalog: [],
    canonical_analytes: [
      { id: '00000000-0000-4000-a000-0000000000a1', slug: 'tsh' },
      { id: '00000000-0000-4000-a000-0000000000a2', slug: 'ferritin' },
    ],
  };
  readonly reportPatches: Row[] = [];
  readonly storage = new Map<string, { owner: string; bytes: number }>();
  /** Revoked by logout and by account deletion. */
  private readonly tokens = new Map<string, string>();
  /** Requests answered, as `METHOD /path` only (no query, headers or bodies). */
  readonly served: string[] = [];
  readonly unexpected: string[] = [];
  functions: Record<string, (uid: string, body: Row) => Promise<{ status: number; body: unknown }>> = {};

  /* ── auth ─────────────────────────────────────────────────────────────── */

  private issue(user: AuthUser) {
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    // Unsigned, deliberately invalid outside this stand-in. Not a credential.
    const accessToken = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
      sub: user.id, exp: expiresAt, role: 'authenticated', aud: 'authenticated', email: user.email,
      session_id: randomUUID(),
    })}.synthetic`;
    this.tokens.set(accessToken, user.id);
    return {
      access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: expiresAt,
      refresh_token: `synthetic-refresh-${randomUUID()}`, user: this.publicUser(user),
    };
  }

  publicUser(user: AuthUser) {
    return {
      id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
      email_confirmed_at: user.created_at, app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, identities: [], created_at: user.created_at, updated_at: user.created_at,
    };
  }

  uid(headers: Record<string, string>): string | null {
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    const id = this.tokens.get(token);
    return id && this.authUsers.has(id) ? id : null;
  }

  /** The handle_new_user trigger's row (subscription_status defaults to 'trial'). */
  private signUp(email: string, password: string) {
    if ([...this.authUsers.values()].some(u => u.email === email)) return null;
    const user: AuthUser = { id: randomUUID(), email, password, created_at: new Date().toISOString() };
    this.authUsers.set(user.id, user);
    this.tables.users.push({
      id: user.id, email, full_name: null, has_consented: false, onboarding_completed: false,
      onboarding_skipped: false, trial_start_date: null, subscription_status: 'trial', created_at: user.created_at,
    });
    return user;
  }

  deleteAuthUser(userId: string) {
    this.authUsers.delete(userId);
    this.tables.iap_subscriptions = this.tables.iap_subscriptions.filter(r => r.user_id !== userId);
    for (const [token, id] of this.tokens) if (id === userId) this.tokens.delete(token);
  }

  /* ── PostgREST ────────────────────────────────────────────────────────── */

  /** The rows this user may see in `table`; null for a table not modelled. */
  visible(table: string, uid: string | null): Row[] | null {
    if (PUBLIC_TABLES.has(table)) return this.tables[table];
    if (!(table in this.tables) && !(table in this.views) && table !== 'stripe_user_subscriptions') return null;
    if (!uid) return [];
    const reports = new Set<unknown>(this.tables.lab_reports.filter(r => r.user_id === uid).map(r => r.id));
    if (table === 'users') return this.tables.users.filter(r => r.id === uid);
    if (USER_TABLES.has(table)) return this.tables[table].filter(r => r.user_id === uid);
    if (REPORT_TABLES.has(table)) return this.tables[table].filter(r => reports.has(r.lab_report_id));
    if (table === 'stripe_user_subscriptions') {
      return this.tables.stripe_subscriptions.filter(r => this.tables.stripe_customers.some(c => c.user_id === uid && c.customer_id === r.customer_id))
        .map(r => ({ customer_id: r.customer_id, subscription_id: r.subscription_id, subscription_status: r.status,
          price_id: r.price_id, current_period_start: null, current_period_end: r.current_period_end,
          cancel_at_period_end: false, payment_method_brand: null, payment_method_last4: null }));
    }
    const view = this.views[table];
    return view ? view(uid) : null;
  }

  /** Read-only views computed by the server model (e.g. `interpretations`). */
  views: Record<string, (uid: string) => Row[]> = {};

  private matches(row: Row, key: string, raw: string): boolean | null {
    const m = /^(not\.)?(eq|neq|lt|lte|gt|gte|in|is)\.(.*)$/s.exec(raw);
    if (!m) return null;
    const [, not, op, operand] = m;
    const value = row[key];
    const text = value === null || value === undefined ? null : String(value);
    let result: boolean;
    switch (op) {
      case 'eq': result = text === operand; break;
      case 'neq': result = text !== operand; break;
      case 'lt': result = text !== null && text < operand; break;
      case 'lte': result = text !== null && text <= operand; break;
      case 'gt': result = text !== null && text > operand; break;
      case 'gte': result = text !== null && text >= operand; break;
      case 'in': {
        const list = /^\((.*)\)$/s.exec(operand)?.[1].split(',').map(s => s.replace(/^"|"$/g, '')) ?? null;
        if (!list) return null;
        result = text !== null && list.includes(text); break;
      }
      case 'is': result = operand === 'null' ? value === null || value === undefined : String(value) === operand; break;
      default: return null;
    }
    return not ? !result : result;
  }

  private filter(rows: Row[], params: URLSearchParams): Row[] | null {
    let out = rows;
    for (const [key, raw] of params) {
      if (['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(key)) continue;
      const next: Row[] = [];
      for (const row of out) {
        const ok = this.matches(row, key, raw);
        if (ok === null) return null;
        if (ok) next.push(row);
      }
      out = next;
    }
    return out;
  }

  private project(rows: Row[], select: string | null): Row[] | null {
    if (!select || select === '*') return rows.map(r => ({ ...r }));
    const columns = select.split(',').map(c => c.trim());
    if (columns.some(c => !/^[a-z_][a-z0-9_]*$/.test(c))) return null; // embeds are not modelled
    return rows.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? null])));
  }

  private order(rows: Row[], order: string | null): Row[] {
    if (!order) return rows;
    const terms = order.split(',').map(t => t.split('.'));
    return [...rows].sort((a, b) => {
      for (const [column, direction = 'asc'] of terms) {
        const x = String(a[column] ?? ''), y = String(b[column] ?? '');
        if (x !== y) return (direction === 'desc' ? -1 : 1) * x.localeCompare(y);
      }
      return 0;
    });
  }

  private defaults(table: string, row: Row): Row {
    const base: Row = { id: randomUUID() };
    if (table === 'lab_reports') Object.assign(base, { regeneration_count: 0, content_hash: null });
    return { ...base, ...row };
  }

  private canWrite(table: string, uid: string, row: Row): boolean {
    if (table === 'users') return row.id === uid;
    if (USER_TABLES.has(table)) return row.user_id === uid;
    if (REPORT_TABLES.has(table)) {
      return this.tables.lab_reports.some(r => r.id === row.lab_report_id && r.user_id === uid);
    }
    return false;
  }

  /* ── dispatch ─────────────────────────────────────────────────────────── */

  async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = await request.allHeaders();
    const label = `${method} ${url.pathname}`;
    // PostgREST/GoTrue CORS: any origin, count exposed through content-range.
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
    const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers: { ...cors, ...extra }, body: JSON.stringify(body) });
    const empty = (status: number, extra: Record<string, string> = {}) =>
      route.fulfill({ status, headers: { ...cors, ...extra }, body: '' });
    const reject = async () => {
      this.unexpected.push(label);
      await route.abort('blockedbyclient');
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    this.served.push(label);

    if (url.pathname === '/auth/v1/signup' && method === 'POST') {
      const { email, password } = request.postDataJSON() as { email: string; password: string };
      const user = this.signUp(email, password);
      if (!user) return json(422, { code: 422, error_code: 'user_already_exists', msg: 'User already registered' });
      return json(200, this.issue(user));
    }
    if (url.pathname === '/auth/v1/token' && method === 'POST' && url.searchParams.get('grant_type') === 'password') {
      const { email, password } = request.postDataJSON() as { email: string; password: string };
      const user = [...this.authUsers.values()].find(u => u.email === email && u.password === password);
      if (!user) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      return json(200, this.issue(user));
    }
    if (url.pathname === '/auth/v1/user' && method === 'GET') {
      const uid = this.uid(headers);
      if (!uid) return json(403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return json(200, this.publicUser(this.authUsers.get(uid)!));
    }
    if (url.pathname === '/auth/v1/logout' && method === 'POST') {
      this.tokens.delete((headers.authorization ?? '').replace(/^Bearer /, ''));
      return empty(204);
    }

    const uid = this.uid(headers);
    const storage = /^\/storage\/v1\/object\/lab-files\/(.+)$/.exec(url.pathname);
    if (storage && method === 'POST') {
      const path = decodeURIComponent(storage[1]);
      if (!uid || !path.startsWith(`${uid}/`)) {
        return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      }
      this.storage.set(path, { owner: uid, bytes: request.postDataBuffer()?.length ?? 0 });
      return json(200, { Key: `lab-files/${path}`, Id: randomUUID() });
    }

    const fn = /^\/functions\/v1\/([a-z-]+)$/.exec(url.pathname);
    if (fn && method === 'POST' && this.functions[fn[1]]) {
      if (!uid) return json(401, { error: 'Unauthorized' });
      const result = await this.functions[fn[1]](uid, (request.postDataJSON() ?? {}) as Row);
      return json(result.status, result.body);
    }

    const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
    if (rpc && method === 'POST' && rpc[1] === 'start_trial_if_unset' && uid) {
      // Writes only while NULL (20260823000000_lock_users_privileged_columns.sql).
      const row = this.tables.users.find(r => r.id === uid)!;
      if (row.trial_start_date == null) row.trial_start_date = new Date().toISOString();
      return empty(204);
    }

    const rest = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
    if (!rest) return reject();
    const table = rest[1];
    const params = url.searchParams;
    const generatedColumns = (TABLE_COLUMNS as Record<string, readonly string[]>)[table];
    const columns = table === 'users' ? [...generatedColumns, 'full_name', 'onboarding_completed', 'onboarding_skipped',
      'health_goals', 'symptoms', 'supplements', 'known_conditions', 'sex_at_birth', 'pregnancy_status'] : generatedColumns;
    if (columns) {
      const requested = [...params.keys()].filter(k => !['select', 'order', 'limit', 'offset', 'columns', 'on_conflict'].includes(k));
      for (const key of ['select', 'columns', 'on_conflict']) {
        const value = params.get(key);
        if (value && value !== '*') requested.push(...value.split(',').map(c => c.trim().replaceAll('"', '')));
      }
      if (params.get('order')) requested.push(...params.get('order')!.split(',').map(c => c.split('.')[0]));
      if (method === 'POST' || method === 'PATCH') {
        const body = request.postDataJSON() as Row | Row[];
        for (const row of Array.isArray(body) ? body : [body]) requested.push(...Object.keys(row));
      }
      const invalid = requested.find(c => !columns.includes(c));
      if (invalid) return json(400, { code: '42703', message: `column ${table}.${invalid} does not exist` });
    }
    const visible = this.visible(table, uid);
    if (visible === null) return reject();
    const single = (headers.accept ?? '').includes('application/vnd.pgrst.object+json');
    const prefer = headers.prefer ?? '';
    const respond = (rows: Row[], status = 200) => {
      if (single) {
        if (rows.length !== 1) return json(406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return json(status, rows[0]);
      }
      return json(status, rows);
    };

    if (method === 'GET' || method === 'HEAD') {
      const filtered = this.filter(visible, params);
      if (!filtered) return reject();
      const ordered = this.order(filtered, params.get('order'));
      const offset = Number(params.get('offset') ?? 0);
      const limit = params.get('limit');
      const page = ordered.slice(offset, limit === null ? undefined : offset + Number(limit));
      const range = { 'content-range': page.length ? `${offset}-${offset + page.length - 1}/${filtered.length}` : `*/${filtered.length}` };
      if (method === 'HEAD') return empty(200, range);
      const projected = this.project(page, params.get('select'));
      if (!projected) return reject();
      return prefer.includes('count=') ? json(200, projected, range) : respond(projected);
    }

    if (!uid || this.views[table] || table === 'stripe_user_subscriptions' || PUBLIC_TABLES.has(table)) return reject();
    if (method === 'POST') {
      const body = request.postDataJSON() as Row | Row[];
      const incoming = (Array.isArray(body) ? body : [body]).map(r => this.defaults(table, r));
      if (!incoming.every(r => this.canWrite(table, uid, r))) {
        return json(403, { code: '42501', message: `new row violates row-level security policy for table "${table}"` });
      }
      const inserted: Row[] = [];
      for (const row of incoming) {
        // Primary key: a plain insert of an existing id is PostgreSQL's 23505 (409).
        if (this.tables[table].some(r => r.id === row.id) && !params.get('on_conflict')) {
          return json(409, { code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` });
        }
        const conflict = params.get('on_conflict');
        if (conflict && this.tables[table].some(r => r[conflict] === row[conflict])) {
          if (prefer.includes('resolution=ignore-duplicates')) continue;
          return reject();
        }
        this.tables[table].push(row);
        inserted.push(row);
      }
      if (!prefer.includes('return=representation')) return empty(201);
      const projected = this.project(inserted, params.get('select'));
      return projected ? respond(projected, 201) : reject();
    }
    if (method === 'PATCH' || method === 'DELETE') {
      const targets = this.filter(visible, params);
      if (!targets) return reject();
      if (method === 'PATCH') {
        const patch = request.postDataJSON() as Row;
        if (table === 'lab_reports') this.reportPatches.push(structuredClone(patch));
        for (const row of targets) Object.assign(row, patch);
      } else {
        this.tables[table] = this.tables[table].filter(r => !targets.includes(r));
        // lab_reports ON DELETE CASCADE children.
        if (table === 'lab_reports') {
          const gone = new Set(targets.map(r => r.id));
          for (const child of REPORT_TABLES) this.tables[child] = this.tables[child].filter(r => !gone.has(r.lab_report_id));
        }
      }
      if (!prefer.includes('return=representation')) return empty(204);
      const projected = this.project(targets, params.get('select'));
      return projected ? respond(projected) : reject();
    }
    return reject();
  }
}
