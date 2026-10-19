import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cases = [
  ['missing URL', undefined, 'synthetic-anon'],
  ['missing key', 'http://127.0.0.1:54321', undefined],
  ['hosted', 'https://synthetic.supabase.co', 'synthetic-anon'],
  ['localhost suffix', 'http://localhost.example.com', 'synthetic-anon'],
  ['IP suffix', 'http://127.0.0.1.nip.io', 'synthetic-anon'],
  ['userinfo', 'http://localhost@x.supabase.co', 'synthetic-anon'],
  ['unparseable', 'not a URL', 'synthetic-anon'],
];
for (const [name, url, key] of cases) {
  test(`real stack refuses ${name} before any spawn`, { timeout: 10_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'amani-journey-guard-'));
    const marker = join(dir, 'spawned');
    try {
      for (const command of ['npm', 'npx']) {
        const file = join(dir, command);
        await writeFile(file, '#!/bin/sh\n: > "$GUARD_MARKER"\nexit 0\n');
        await chmod(file, 0o755);
      }
      // Explicit environment: never inherit credentials, NODE_OPTIONS, or VITE_*.
      const env = { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`,
        E2E_REAL_SUPABASE: '1', GUARD_MARKER: marker };
      if (url !== undefined) env.SUPABASE_URL = url;
      if (key !== undefined) env.SUPABASE_ANON_KEY = key;
      const child = spawn(process.execPath, ['e2e/server.mjs', '--freemium', '--preview'], {
        cwd: root, env, detached: true, stdio: 'ignore',
      });
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ }
          reject(new Error('guard child exceeded hard timeout'));
        }, 5_000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      });
      assert.deepEqual(result, { code: 1, signal: null });
      await assert.rejects(access(marker), { code: 'ENOENT' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
