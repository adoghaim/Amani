import axe from 'axe-core';

/**
 * Test helper, imported only by tests: axe-core (D23) on a component rendered
 * in jsdom. Every violation is returned as "rule: target", so a test reads
 * `expect(await axeViolations(root)).toEqual([])` and a failure names it.
 *
 * Two rules are off here, and only here:
 * - color-contrast: jsdom does no layout or paint, so axe cannot measure it.
 *   `npm run validate:contrast` checks every text token, and the Playwright
 *   specs run axe with it on, in real browsers.
 * - region: a component on its own is not a page; the page's landmarks come
 *   from Layout or FullScreenGate.
 */
export async function axeViolations(node: Element): Promise<string[]> {
  const results = await axe.run(node, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  return results.violations.flatMap(violation =>
    violation.nodes.map(result => `${violation.id}: ${result.target.join(' ')}`));
}
