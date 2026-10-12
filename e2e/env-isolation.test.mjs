import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

test('E2E served modules exclude developer env files and inherited VITE values', {
  timeout: 45_000,
}, async t => {
  const created = [];
  let server;
  t.after(async () => {
    try {
      if (server?.pid && server.exitCode === null && server.signalCode === null) {
        const closed = once(server, 'close');
        process.kill(-server.pid, 'SIGTERM');
        const forceStop = setTimeout(() => {
          try { process.kill(-server.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
        }, 5_000);
        try { await closed; } finally { clearTimeout(forceStop); }
      }
    } finally {
      await Promise.all(created.map(path => unlink(path)));
    }
  });

  assert.deepEqual(await readdir(new URL('./no-env/', import.meta.url)), ['.gitkeep'],
    'The committed env directory must remain empty except for .gitkeep');
  for (const name of ['.env', '.env.local', '.env.e2e', '.env.e2e.local']) {
    const path = new URL(`../${name}`, import.meta.url);
    // Refuse to overwrite a developer file; cleanup removes only files we created.
    await writeFile(path,
      'VITE_APP_URL=https://task-043-env-canary.example.invalid\nVITE_FREEMIUM_ACTIVE=true\n',
      { flag: 'wx' });
    created.push(path);
  }

  server = spawn(process.execPath, ['e2e/server.mjs'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      VITE_APP_URL: 'https://task-043-inherited-canary.example.invalid',
      VITE_FREEMIUM_ACTIVE: 'true',
    },
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('E2E server readiness timed out')), 30_000);
    let output = '';
    const onOutput = chunk => {
      output += chunk.toString();
      if (output.includes('http://127.0.0.1:4173/')) finish();
    };
    const onExit = code => finish(new Error(`E2E server exited before readiness (code ${code})`));
    const onError = error => finish(error);
    const finish = error => {
      clearTimeout(timeout);
      server.stdout.off('data', onOutput);
      server.off('exit', onExit);
      server.off('error', onError);
      if (error) reject(error); else resolve();
    };
    server.stdout.on('data', onOutput);
    // Only print the known bind denial; do not echo arbitrary server logs.
    server.stderr.on('data', chunk => {
      if (chunk.toString().includes('EPERM')) t.diagnostic('Server bind denied: EPERM');
    });
    server.once('exit', onExit);
    server.once('error', onError);
  });

  for (const path of ['/src/lib/tier.ts', '/src/components/pricing/PricingCard.tsx']) {
    const response = await fetch(`http://127.0.0.1:4173${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    assert.equal(response.status, 200, path);
    const module = await response.text();
    assert.ok(module.includes('https://amani-e2e.invalid'), 'Synthetic env injection is present');
    assert.ok(!module.includes('task-043-env-canary'), 'Env-file sentinel must be absent');
    assert.ok(!module.includes('task-043-inherited-canary'), 'Inherited sentinel must be absent');
    assert.doesNotMatch(module, /"VITE_FREEMIUM_ACTIVE"\s*:/,
      'Developer feature flag must be absent from the injected env object');
    t.diagnostic(`${path}: HTTP 200; synthetic env present; file/inherited sentinels absent`);
  }
});
