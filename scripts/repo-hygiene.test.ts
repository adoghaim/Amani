// Repo hygiene pins (review F080, F081, F090): per-machine tool state must not
// be tracked, must be ignored, and files tracked on purpose must stay visible.
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url).pathname;
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
// check-ignore exits 0 when the path is ignored, 1 when it is not.
const isIgnored = (path: string) =>
  spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root }).status === 0;

describe('tracked leftovers (F080, F090)', () => {
  it.each(['supabase/.temp', 'logs.txt', '.bolt', 'apps/mobile/.expo'])('%s is not tracked', (path) => {
    expect(git('ls-files', '--', path).trim()).toBe('');
  });
});

describe('ignored local state (F080, F081)', () => {
  it.each([
    'supabase/.temp/cli-latest',
    'supabase/.branches/x',
    '.env.production',
    '.env.development',
    '.env.staging',
    'graphify-out/graph.json',
    'apps/mobile/.expo/devices.json',
    '.expo/devices.json',
    'logs.txt',
  ])('%s is ignored', (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  it.each(['.env.example', 'jarvis/.env.example', 'e2e/no-env/.gitkeep'])(
    '%s stays visible (tracked on purpose)',
    (path) => {
      expect(isIgnored(path)).toBe(false);
      expect(git('ls-files', '--', path).trim()).toBe(path);
    },
  );
});
