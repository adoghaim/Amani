#!/usr/bin/env node
// Prints the factory daily report from factory/status.json. No network, no writes.
// Usage: node factory/scripts/report.mjs [--json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ledger = JSON.parse(readFileSync(join(here, '..', 'status.json'), 'utf8'));
const pk = ledger.packets;
const done = new Set(pk.filter((p) => p.status === 'done').map((p) => p.id));
const phaseOrder = ledger.phases.map((p) => p.id);
const byOrder = (a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) || a.wave.localeCompare(b.wave) || a.id.localeCompare(b.id);

const out = {
  shipped: pk.filter((p) => p.status === 'done').map((p) => ({ id: p.id, title: p.title, pr: p.pr, deployed: p.deployed })),
  in_progress: pk.filter((p) => ['in-progress', 'review'].includes(p.status)).sort(byOrder).map((p) => ({ id: p.id, status: p.status, pr: p.pr })),
  blocked: pk.filter((p) => p.status === 'blocked').map((p) => ({ id: p.id, reason: p.blocked_reason })),
  awaiting_deploy: pk.filter((p) => p.owner_approval && p.deployed && p.deployed.supabase === 'pending').map((p) => p.id),
  next_suggested: pk.filter((p) => p.status === 'todo' && p.depends_on.every((d) => done.has(d))).sort(byOrder).map((p) => ({ id: p.id, title: p.title, wave: p.wave })),
  growth_suggestions: ledger.report?.growth_suggestions ?? [],
};

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  const list = (xs, f) => (xs.length ? xs.map((x) => `  - ${f(x)}`).join('\n') : '  - none');
  console.log(`Amani factory report (${new Date().toLocaleDateString('en-CA')})\n`);
  console.log(`Shipped:\n${list(out.shipped, (x) => `${x.id} ${x.title}${x.pr ? ` (${x.pr})` : ''}`)}\n`);
  console.log(`In progress / review:\n${list(out.in_progress, (x) => `${x.id} [${x.status}]${x.pr ? ` ${x.pr}` : ''}`)}\n`);
  console.log(`Blocked:\n${list(out.blocked, (x) => `${x.id}: ${x.reason}`)}\n`);
  console.log(`Merged, backend deploy awaiting GO:\n${list(out.awaiting_deploy, (x) => x)}\n`);
  console.log(`Next suggested (deps met):\n${list(out.next_suggested, (x) => `${x.id} ${x.title} (wave ${x.wave})`)}\n`);
  console.log(`Growth / marketing:\n${list(out.growth_suggestions, (x) => x)}`);
}
