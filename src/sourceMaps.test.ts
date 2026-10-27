import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { build, type Plugin, type PluginOption } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import appConfig, { removeSourceMaps } from '../vite.config';

/*
  Review F068 / F109: a source map embeds the original source (sourcesContent),
  and everything `vite build` writes is public: Netlify serves dist/, and cap
  sync copies it into the iOS and Android apps. sourcemap: 'hidden' only drops
  the sourceMappingURL comment; the .map files still ship beside every chunk.
*/

const isPlugin = (p: PluginOption): p is Plugin => !!p && typeof p === 'object' && 'name' in p;

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path, root) : [relative(root, path)];
  });
}

const temporary: string[] = [];
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A two-chunk app with a map already sitting in public/, built with maps on. */
async function buildFixture(plugins: Plugin[]): Promise<string[]> {
  // realpath: on macOS tmpdir() is a symlink, and Vite rejects an index.html it resolves outside root.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'amani-maps-')));
  temporary.push(root);
  writeFileSync(join(root, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>');
  writeFileSync(join(root, 'main.js'), "import('./lazy.js').then(m => console.log(m.value));");
  writeFileSync(join(root, 'lazy.js'), 'export const value = 42;');
  mkdirSync(join(root, 'public', 'vendor'), { recursive: true });
  writeFileSync(join(root, 'public', 'vendor', 'lib.js.map'), '{"version":3,"sourcesContent":["secret"]}');
  writeFileSync(join(root, 'public', 'robots.txt'), 'User-agent: *\n');
  await build({
    root,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins,
    build: { sourcemap: true, outDir: 'dist' },
  });
  return listFiles(join(root, 'dist')).sort();
}

describe('source maps never reach the build output (F068, F109)', () => {
  it.each([['web', undefined], ['native', 'native']] as const)(
    'the %s build emits no maps and runs removeSourceMaps',
    (_target, buildTarget) => {
      const previous = process.env.BUILD_TARGET;
      if (buildTarget) process.env.BUILD_TARGET = buildTarget;
      else delete process.env.BUILD_TARGET;
      try {
        const config = appConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false });
        expect(config.build?.sourcemap).toBe(false);
        const names = (config.plugins ?? []).flat(2).filter(isPlugin).map(p => p.name);
        expect(names).toContain('amani:remove-source-maps');
      } finally {
        if (previous === undefined) delete process.env.BUILD_TARGET;
        else process.env.BUILD_TARGET = previous;
      }
    },
  );

  it('removeSourceMaps deletes every .map in the output, bundled or copied from public/, and keeps the rest', async () => {
    const control = await buildFixture([]);
    expect(control.filter(f => f.endsWith('.map')).length).toBeGreaterThanOrEqual(3);

    const output = await buildFixture([removeSourceMaps()]);
    expect(output.filter(f => f.endsWith('.map'))).toEqual([]);
    expect(output).toEqual(control.filter(f => !f.endsWith('.map')));
    expect(output).toEqual(expect.arrayContaining(['index.html', 'robots.txt']));
    expect(output.filter(f => f.endsWith('.js'))).toHaveLength(2);
  });
});
