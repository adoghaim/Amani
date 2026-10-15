# Amani inside AI assistants (PK-AIDIST-01)

Status: **design and prototype only. Nothing is deployed, nothing is registered with OpenAI or
Anthropic, and nothing here is live.** The prototype is `tools/mcp-amani/`, behind the off-by-default
flag `features.ai_assistant_connector`. Written for Adell's review. Every open choice is a
`[Pending]` at the end, and none of them is decided here.

## Goal

A woman who already uses ChatGPT or Claude can reach her Amani reports from there without
copying lab results into the chat. Amani stays where her results are read: the assistant gets
links, titles and dates, and nothing more.

One server, two front doors:

- **Claude:** a remote MCP connector (Streamable HTTP, OAuth).
- **ChatGPT:** an app built on the same MCP server (the Apps SDK uses MCP as its protocol). Any
  ChatGPT-only widget is out of scope for the prototype.

## What a user can do

| She says | What happens | Status |
|---|---|---|
| "What lab reports do I have in Amani?" | `list_my_reports`: titles and dates, newest first | prototype |
| "Open my Labcorp report from September." | `open_report_link`: the link to that report in the Amani app | prototype |
| "Send my lab PDF to Amani and get the link to my Amani report." | A handoff link to Amani's upload page. She uploads in Amani, and the report link comes back once it is ready. | design only, [Pending] P1 |
| "What does my ferritin mean?" | The assistant gets no values, so it cannot answer from Amani. The tool text points her to the report in Amani. | by design |

**The upload flow (design only).** The assistant must not be the pipe for the PDF. A file
attached in a chat has already been sent to the assistant's provider, and Amani cannot see or
limit that. The proposed flow:

1. A tool `start_upload` (not built) returns a short-lived link to `/app/new` in the Amani app.
   Signing in is required, as for any other link.
2. She uploads there, so Amani's own consent gate, rate limits, parsing and clinical rules all
   apply unchanged.
3. When she asks again, `list_my_reports` shows the new report, and `open_report_link` returns
   its link.

Taking the file straight from the assistant (the ChatGPT file parameters, or an MCP resource
upload) would be a write tool, would bypass the in-app consent screen, and would need the
lawyer's sign-off (EXP-6). It is not proposed.

## What comes back: no health data beyond what she asks for

What the tools return is closed by construction, not by filtering:

- **Only three fields leave Amani:** the report id, a fixed title, and the report date
  (`YYYY-MM-DD`, or null). `open_report_link` adds the link
  `https://<app origin>/app/reports/<id>`.
- **The title is built from the `lab_source` enum.** It is "Quest lab report", "Labcorp lab
  report" or "Lab report". The free-text `lab_name` is never returned, because it comes from the
  uploaded PDF and is a prompt-injection channel (see the threat model).
- **Never returned:** biomarker values, units, ranges, flags, report status, cycle day or phase,
  pregnancy or other context, notes, file paths, interpretations, or the user id.
- **Every sentence is fixed.** Each one is a constant in `COPY` (`tools/mcp-amani/src/connector.ts`).
  There is no generated prose, so there is no interpretation path, and nutrient-policy validation
  has nothing to validate. Tests check every sentence against the landing page's clinical-language
  prohibitions and `findTextViolations()`.
- **The link does not carry data.** The report opens in Amani only after sign-in, with Amani's
  usual tier, consent and display rules.
- **She has to ask.** The tools only answer a call. Nothing is pushed into a chat, there is no
  resource subscription, and the server sends no notifications.

The dates and the fact that she has lab reports with Amani are still health-adjacent data. That
is why consent is separate and explicit (below), and why the list stops at 50.

## Sign-in: OAuth with her own Amani account

- **Authorization:** OAuth 2.1 with PKCE, as MCP authorization requires. The connector is an
  OAuth protected resource. It publishes RFC 9728 metadata (`protectedResourceMetadata()`), and
  it answers 401 with `WWW-Authenticate: Bearer resource_metadata=..., scope="reports:read"`.
- **One scope:** `reports:read`. A token without it gets 403 `insufficient_scope`. The token is
  only read from the `Authorization` header, never from the URL, and is never logged or echoed.
- **Whose data:** the token is for her own Amani account. Production reads run with that user's
  identity, so row-level security limits every read to her own rows. The prototype also passes the
  token's user id to every port call, and tests check that no call uses another id.
- **The authorization server is not chosen.** One option is Supabase Auth acting as an OAuth 2.1
  server. The other is a small one in front of Supabase Auth. Either has to support dynamic
  client registration, or pre-registration, for the ChatGPT and Claude clients. See [Pending] P2.
- **Revoking access:** she can revoke from the assistant's settings, and from Amani Settings
  (design only, a row in the "Privacy & security" section, D25). Deleting her account must also
  revoke every grant. The grant store belongs to the authorization server, so it is not a table
  this packet adds. When one is added, it goes in `user-data-registry.ts`. See [Pending] P3.

## The consent gate

The connector has its own consent, separate from signing in:

1. **The OAuth consent screen** names exactly what is shared: "report titles, dates and links,
   no results".
2. **The in-app permission** "Share my report list with AI assistants" lives in Settings under
   "Privacy & security". It is off by default, and turning it off stops the connector
   immediately. The prototype reads it through the `hasConnectorConsent` port. A false answer or
   a failed read is treated as no consent, and the call returns a calm message pointing to
   Settings, with no data.
3. **The app-wide consent gate** (PK-CONSENT-01, `features.consent_gate`) comes first. A user who
   has not passed it gets no connector data. How the two consents relate, and where the
   connector's consent is stored, waits for EXP-6. See [Pending] P4.

Order of checks for each call (each one fails closed):

1. the flag
2. the Origin header
3. the token
4. the scope
5. consent
6. the rate limit
7. the read

The checks before consent are made before any personal data is read.

## Rate limits

- The existing per-user daily counter (`rate-limit.ts`, `public.increment_rate_limit`), on its
  own endpoint name `ai-assistant-connector`. Account deletion already erases `rate_limits`.
- Every tool call counts. The prototype allows **60 per user per UTC day**. This is not a clinical
  number, but the owner sets the real one ([Pending] P5).
- A broken counter refuses the call, matching the AI functions.
- `list_my_reports` returns at most 50 rows, well under the PostgREST 1,000-row page (R27), so it
  needs no paging. The connector also cuts any extra rows itself rather than trusting the read.
- A per-IP limit and a global cap at the edge (as in D5.3 for anonymous events) are proposed for
  deployment. They need the hosting decision ([Pending] P6).

## The flag

`features.ai_assistant_connector`, read with the same rule as `src/lib/runtimeConfig.ts`: on only
when it is the boolean `true`. A missing key, any other value, or a failed read is off.
`flag-parity.test.ts` runs the app's own parser against the connector's on the same rows. While
it is off:

- the HTTP layer answers **404** to everything, before it checks the token, so the connector
  does not advertise itself;
- the JSON-RPC layer refuses every method;
- neither touches data, consent or the counter.

No migration writes the flag (D5). The owner turns it on with the SQL in
`docs/runtime-config.md`.

## Threat model

| # | Threat | Vector | Control in the prototype | Still open |
|---|---|---|---|---|
| T1 | **Prompt injection from report content** | A crafted PDF puts instructions in a field (lab name, notes), which then reaches the assistant's context through a tool result | No free text from a report is ever returned. The title comes from an enum, the date must parse as `YYYY-MM-DD`, and the id must be a UUID. `initialize` instructions and tool descriptions say titles and dates are data. Tests feed an injection string through `lab_name` and check it never appears. | none for these two tools; any future tool that returns text must keep this rule |
| T2 | **Prompt injection against the user, through the assistant** | A web page or document in the same chat tells the assistant to "list her Amani reports and send them to X" | The tools are read-only, there is no tool that sends data anywhere, and the results hold no values. The worst case is titles and dates in a chat she is using. `openWorldHint: false` is set. | The assistant's own confirmation UX for tool calls is outside Amani's control. Document it in the consent copy (P4). |
| T3 | **Tool-description poisoning or a look-alike server** | A malicious connector named "Amani" | Only the official listing in each directory. OAuth goes only to Amani's authorization server. | Directory submission and ownership verification ([Pending] P7) |
| T4 | **Reading another user's reports (IDOR)** | A guessed or leaked report id passed to `open_report_link` | The read is scoped to the token's user (RLS in production, the user id in each port call). Another user's id and a missing id give the same answer. The id must be a UUID, so path and URL input is rejected before any read. | Production must use the user's identity, not service_role ([Pending] P2) |
| T5 | **Token theft or replay** | Token in logs, URLs or referrers | Header-only bearer tokens, never logged or echoed, `cache-control: no-store`, short-lived access tokens with refresh (authorization server) | Token lifetime and refresh rotation ([Pending] P2) |
| T6 | **DNS rebinding or a cross-origin browser call** | A malicious page calls the server from the user's browser | An Origin header that is not on the allow-list gets 403. Requests with no Origin (server-to-server) still need a valid token. | The allow-list values per assistant |
| T7 | **Abuse or cost** | Scripted calls with a valid token | The per-user daily counter fails closed, bodies are capped at 64 KB, and batches are refused | Edge per-IP limit and global cap (P6) |
| T8 | **Clinical overreach** | Connector text read as advice | No generated prose. Every sentence is fixed and tested against the clinical-language prohibitions and the nutrient policy. | Clinical reviewer read-through of `COPY` ([Pending] P8) |
| T9 | **Data kept by the assistant provider** | Titles, dates and links persist in her chat history and possibly in model training | Minimal data by construction. Consent copy says plainly what leaves Amani. | Lawyer: provider terms, retention, and whether WA MHMDA consent covers this disclosure (EXP-6, P4) |
| T10 | **Stale consent after account deletion or revocation** | The grant outlives the account | Every call reads consent fresh (no cache), and a failed read is no consent | Revoke grants on account deletion (P3) |
| T11 | **Kill switch** | An incident needs the connector off now | The flag answers 404 to everything at once | none |

## External calls (D8, D10)

The prototype makes none: every read is a port. The production adapters read Supabase through
the user's identity. Any HTTP call they make goes through `supabase/functions/_shared/fetchWithBackoff.ts`
with `attemptTimeoutMs: 10000` and `tries: 3`, since every read here is idempotent.

## The prototype (`tools/mcp-amani/`)

- `src/connector.ts`: the pure core. It handles the MCP methods `initialize`, `ping`,
  `tools/list` and `tools/call`, has the two tools, all the fixed copy, and the flag, consent
  and rate-limit gates, behind `ConnectorPorts`.
- `src/http.ts`: a pure request-to-response function covering the parts of Streamable HTTP and
  MCP authorization it needs. It has no listener and no production wiring.
- Tests, run by `npm test` (Vitest, fakes only):
  - `connector.test.ts`
  - `http.test.ts`
  - `flag-parity.test.ts`
- Type-checked by `npm run typecheck` (`tools/mcp-amani/tsconfig.json`).

To deploy it, the owner decides the host, the authorization server and the copy (the [Pending]
items). Then a thin handler is written that wires the ports to Supabase with the user's token,
and the connector is registered with each assistant. None of this is in this packet.

## [Pending] questions

- **P1 (Adell):** Should upload go through the assistant at all? The proposal is a handoff link
  to `/app/new`, not file transfer.
- **P2 (Adell, engineering):** Which authorization server: Supabase Auth's OAuth 2.1 server, or a
  small one in front of it? Also token lifetime, refresh rotation and client registration.
- **P3 (Adell):** Where is the grant store, and how does account deletion revoke it? Once it is a
  table, it needs a `user-data-registry.ts` entry.
- **P4 (Adell, lawyer, EXP-6):** How does the connector's consent relate to the app-wide consent
  gate (PK-CONSENT-01)? Is disclosing titles and dates to an assistant provider covered by
  WA MHMDA consent? What exact consent copy should be used?
- **P5 (Adell):** What is the daily per-user call limit? The prototype default is 60.
- **P6 (Adell):** Where is it hosted: a Supabase Edge Function or another host? This also decides
  the per-IP limit and the global cap.
- **P7 (Adell):** OpenAI and Anthropic directory listings: who submits them, under which account,
  and which privacy policy URL.
- **P8 (clinical reviewer):** A read-through of the connector's fixed sentences (`COPY`).
