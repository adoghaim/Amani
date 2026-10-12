import { spawn } from 'node:child_process';

// Clear inherited client variables; e2e/vite.config.ts redirects env-file
// lookup to the committed empty e2e/no-env directory.
// This wraps the existing Vite config; it changes only the E2E server process.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_')) delete process.env[name];
}
// Explicit isolated Freemium suite; never inherit this flag from a developer env.
if (process.argv.includes('--freemium')) process.env.VITE_FREEMIUM_ACTIVE = 'true';

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
