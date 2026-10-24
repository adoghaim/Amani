import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';

/*
  Review F071. The .safe-top / .safe-bottom helpers sit in @layer base, so
  Tailwind emits them before every utility, and `p-4` or `py-12` on the same
  element always beat them: the sheet's footer sat 16px from the screen edge,
  under the Android navigation bar, whatever the comment said.

  jsdom cannot cascade env()/max(), so this compiles the real stylesheet with the
  real Tailwind config over the real class string and asks which padding rule is
  emitted LAST for the element (equal specificity: the last one wins).
*/

const unescapeSelector = (selector: string) => selector
  .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\(.)/g, '$1');

async function lastPadding(classes: string, side: 'top' | 'bottom') {
  const config = (await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'tailwind.config.js')).href) as
    { default: Record<string, unknown> }).default;
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8').replace(/^@import .*$/m, '');
  const result = await postcss([tailwindcss({ ...config, content: [{ raw: `<div class="${classes}"></div>`, extension: 'html' }] })])
    .process(css, { from: undefined });
  const wanted = new Set(classes.split(/\s+/).map(c => `.${c}`));
  const property = `padding-${side}`;
  const winners: string[] = [];
  result.root.walkRules(rule => {
    if (!rule.selectors.some(s => wanted.has(unescapeSelector(s)))) return;
    rule.walkDecls(decl => {
      if (decl.prop === property || decl.prop === 'padding') winners.push(decl.value);
    });
  });
  return winners[winners.length - 1];
}

/** The overlay's and the success page's class strings, read from the source. */
function classesOf(file: string, marker: string): string {
  const source = readFileSync(join(process.cwd(), file), 'utf8');
  const line = source.split('\n').find(l => l.includes(marker));
  const match = line?.match(/className="([^"]+)"/);
  if (!match) throw new Error(`${file}: no className on the line containing ${marker}`);
  return match[1]!;
}

describe('safe-area padding actually wins the cascade (F071)', () => {
  const surfaces: Array<[string, string, string]> = [
    ['the Modal overlay', 'src/components/Modal.tsx', 'fixed inset-0 z-[60]'],
    ['the Stripe success page', 'src/pages/SuccessPage.tsx', 'min-h-dvh bg-theme-background'],
  ];
  for (const [name, file, marker] of surfaces) {
    it(`${name}: the last padding rule for each edge reads the inset`, async () => {
      const classes = classesOf(file, marker);
      expect(await lastPadding(classes, 'bottom'), `${name} bottom`).toContain('env(safe-area-inset-bottom');
      expect(await lastPadding(classes, 'top'), `${name} top`).toContain('env(safe-area-inset-top');
    });
  }

  it('negative control: the old p-4 + safe-bottom combination loses to the padding utility', async () => {
    expect(await lastPadding('p-4 safe-top safe-bottom', 'bottom')).toBe('1rem');
  });
});
