import { spawn } from 'node:child_process';

// Clear inherited client variables; e2e/vite.config.ts redirects env-file
// lookup to the committed empty e2e/no-env directory.
// This wraps the existing Vite config; it changes only the E2E server process.
const realSupabase = process.env.E2E_REAL_SUPABASE === '1';
// PK-03e-I real-stack mode reads these two names only; values are never logged.
const realUrl = process.env.SUPABASE_URL;
const realAnonKey = process.env.SUPABASE_ANON_KEY;
for (const name of Object.keys(process.env)) {
  if (name.startsWith('VITE_')) delete process.env[name];
}
// Explicit isolated Freemium suite; never inherit this flag from a developer env.
if (process.argv.includes('--freemium')) process.env.VITE_FREEMIUM_ACTIVE = 'true';

if (realSupabase) {
  // Opt-in only (PK-03e-I): a real LOCAL stack. Refuse anything that is not
  // loopback so this mode can never be pointed at a hosted project.
  if (!realUrl || !realAnonKey) {
    console.error('E2E_REAL_SUPABASE=1 needs SUPABASE_URL and SUPABASE_ANON_KEY');
    process.exit(1);
  }
  const host = new URL(realUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.error('E2E_REAL_SUPABASE=1 accepts only a local Supabase stack (127.0.0.1 or localhost)');
    process.exit(1);
  }
  process.env.VITE_SUPABASE_URL = realUrl;
  process.env.VITE_SUPABASE_ANON_KEY = realAnonKey;
} else {
  process.env.VITE_SUPABASE_URL = 'https://amani-e2e.invalid';
  process.env.VITE_SUPABASE_ANON_KEY = 'synthetic-anon-key-not-a-credential';
}

const listen = ['--host', '127.0.0.1', '--port', '4173', '--strictPort'];
const config = ['--config', 'e2e/vite.config.ts', '--mode', 'e2e'];
// --preview (PK-03e-I): serve the production build, not the dev server.
const previewOutDir = 'e2e/.dist-preview';

function run(args, onExit) {
  const child = spawn('npx', ['vite', ...args], { env: process.env, stdio: 'inherit' });
  child.once('error', error => {
    console.error(error.message);
    process.exit(1);
  });
  child.once('exit', onExit);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => child.kill(signal));
  }
  return child;
}

if (process.argv.includes('--preview')) {
  run(['build', ...config, '--outDir', previewOutDir, '--emptyOutDir'], code => {
    if (code !== 0) process.exit(code ?? 1);
    run(['preview', ...config, '--outDir', previewOutDir, ...listen], previewCode => process.exit(previewCode ?? 1));
  });
} else {
  const server = spawn('npm', [
    'run', 'dev', '--', ...config, ...listen,
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
}
