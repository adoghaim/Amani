import { spawn } from 'node:child_process';

// Never inherit client credentials/telemetry or read a developer's .env files.
// This wraps the existing Vite config; it changes only the E2E server process.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_')) delete process.env[name];
}
process.env.VITE_SUPABASE_URL = 'https://amani-e2e.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'synthetic-anon-key-not-a-credential';

const server = spawn('npm', [
  'run', 'dev', '--', '--config', 'e2e/vite.config.ts',
  '--mode', 'e2e', '--host', '127.0.0.1', '--port', '4173', '--strictPort',
], {
  env: process.env,
  stdio: 'inherit',
});

server.once('error', error => {
  console.error(error.message);
  process.exit(1);
});
server.once('exit', code => process.exit(code ?? 1));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.kill(signal));
}
