// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { labIntervalPlacement } from '../lib/scoring/insightCopy';
import { Landing } from './Landing';

/*
  V2-03b Stage 2, owner R3: "Do not show a hypothetical example Amani would be
  prohibited from saying to a real user." The logic half of the dual proof for
  the landing page; the browser half is in e2e/reports/clinical-language-policy.spec.ts.
*/

// The report page's prohibitions, plus the marketing examples the owner named.
const FORBIDDEN = /borderline|optimal|optimi[sz]|\bnormal\b|abnormal|worr\w*|worsen|deteriorat|improv|better|worse|healthy|reassur|concern|worth (?:discussing|monitoring|tracking|reviewing|focusing|raising|asking)|talk to your doctor|seek care|urgent|priorit|needs attention|elevated|deficien|insufficien|\brisk\b|should|recommend|keep an eye|sits where it should|\b(?:is|are) (?:low|high)\b|what each marker means/i;

function hits(text: string): string[] {
  return [...text.matchAll(new RegExp(FORBIDDEN.source, 'gi'))].map(m => text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40));
}

// The guard's own classification decides what is legal copy, not this test.
const LEGAL = (JSON.parse(readFileSync('docs/clinical/TASK-045/legacy-claim-exceptions.json', 'utf8')) as
  { file: string; text: string; category: string; basis?: string }[])
  .filter(e => e.file === 'src/pages/Landing.tsx' && e.category === 'NOT_CLINICAL_LANGUAGE' && e.basis === 'legal_disclosure')
  .map(e => e.text);

let root: Root;
let app: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubEnv('VITE_FREEMIUM_ACTIVE', 'false');
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
  await act(async () => root.render(<MemoryRouter><Landing /></MemoryRouter>));
  // The specimen is lazily loaded: wait until it is mounted, so the page-wide check sees it.
  for (let i = 0; i < 50 && !app.querySelector('[data-testid="specimen-statements"]'); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
  expect(app.querySelector('[data-testid="specimen-statements"]')).not.toBeNull();
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Page text minus elements whose whole text is a pinned legal disclosure. */
function marketingText(): string {
  const clone = app.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('p')) if (LEGAL.includes(norm(el.textContent))) el.remove();
  return clone.textContent ?? '';
}

describe('owner R3 — the landing page says nothing Amani may not say to a real user', () => {
  it('page-wide: no judgement, reassurance, urgency or unsupported placement anywhere', () => {
    expect(LEGAL.length).toBe(1);
    expect(hits(marketingText())).toEqual([]);
    for (const removed of ['worrying on day 21', 'Ferritin is low', 'sits where it should', 'normal on day 3']) {
      expect(app.textContent).not.toContain(removed);
    }
  });

  it('differentiation is context, not judgement, in the owner\'s words', () => {
    const hero = Array.from(app.querySelectorAll('p')).map(p => norm(p.textContent));
    expect(hero).toContain('Hormone results can mean different things at different points in the menstrual cycle. '
      + 'Amani asks for the missing context instead of guessing.');
  });

  /*
    F136 (review 2026-10-23, owner ruling D7.9): campaign cycle claims are limited to reviewed
    panels, and no range is reviewed yet. The page and the share/search descriptions say what the
    app does (it asks for cycle dates so results are read in context), never that it scores or
    reads results against the cycle.
  */
  const CYCLE_CLAIM = /against (?:your cycle|where you are)|cycle[- ]phase[- ]aware|scores? .{0,40}cycle/i;
  const indexHtml = readFileSync('index.html', 'utf8');
  const descriptions = [
    ['meta description', /<meta name="description" content="([^"]*)"/],
    ['og:description', /<meta property="og:description" content="([^"]*)"/],
    ['twitter:description', /<meta name="twitter:description" content="([^"]*)"/],
  ] as const;

  it('F136: index.html descriptions describe what the app does and make no cycle-scoring claim', () => {
    for (const [name, pattern] of descriptions) {
      const text = indexHtml.match(pattern)?.[1];
      expect(text, name).toBeTruthy();
      expect(text, name).not.toMatch(CYCLE_CLAIM);
      expect(hits(text!), name).toEqual([]);
      expect(text, name).toMatch(/asks for your cycle dates so results are read in context/i);
    }
    expect(indexHtml.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(CYCLE_CLAIM);
  });

  it('F136: the landing headline and feature list make no cycle-scoring claim', () => {
    expect(app.querySelector('h1')?.textContent).toBe('Your labs, read in context.');
    expect(marketingText()).not.toMatch(CYCLE_CLAIM);
    expect(Array.from(app.querySelectorAll('li')).map(li => norm(li.textContent)))
      .toContain('Asks for your cycle dates so results are read in context');
  });

  it('F136 negative control: the claim check sees the copy D7.9 removed', () => {
    for (const old of [
      'scores them against where you are in your cycle',
      'read against your cycle and explained in plain language',
      'Your labs, read against your cycle.',
      'scores your results against cycle-phase-aware ranges',
    ]) expect(old, old).toMatch(CYCLE_CLAIM);
  });

  it('standing rule 5: every specimen statement and bar colour agrees with the value and interval the row prints', () => {
    const rows = Array.from(app.querySelectorAll('[data-specimen-row]'));
    expect(rows.length).toBe(3);
    const statements = app.querySelector('[data-testid="specimen-statements"]');
    for (const row of rows) {
      const value = Number(row.querySelector('[data-specimen-value]')?.textContent);
      const [min, max] = norm(row.querySelector('[data-specimen-interval]')?.textContent).split(' ')[0]!.split('–').map(Number);
      const placement = labIntervalPlacement(value, min, max);
      expect(placement).not.toBeNull();
      // The bar is the policy cue for that placement: neutral within, attention outside. Never red, amber or green.
      expect(row.querySelector('[data-language-cue]')?.getAttribute('data-language-cue')).toBe(placement === 'within' ? 'neutral' : 'attention');
      expect(row.innerHTML).not.toMatch(/flag-(?:ok|watch|low)/);
      const subject = row.getAttribute('data-specimen-row')!;
      const stated = statements?.textContent?.match(new RegExp(`Your ${subject} is (below|within|above) your laboratory's reference interval`));
      if (stated) expect(stated[1]).toBe(placement);
    }
    // The ferritin statements exist, each carrying its authority, and the movement ends at the row's value.
    const parts = Array.from(statements!.querySelectorAll('[data-language-category]'));
    expect(parts.map(p => [p.getAttribute('data-language-category'), p.getAttribute('data-language-source')])).toEqual([
      ['factual_observation', 'patient_lab_interval'], ['factual_observation', 'lab_data'],
    ]);
    expect(parts[0]!.textContent).toBe("Your ferritin is within your laboratory's reference interval.");
    const ferritin = Number(app.querySelector('[data-specimen-row="ferritin"] [data-specimen-value]')?.textContent);
    expect(parts[1]!.textContent).toBe(`Ferritin has dropped from 41 to ${ferritin} ng/mL.`);
    expect(parts[1]!.getAttribute('data-language-claim')).toBe('measured_movement');
  });

  it('negative controls: the checks see the copy R3 removed', () => {
    for (const old of [
      'The same hormone can be normal on day 3 and worrying on day 21.',
      'Ferritin is low and has been falling since October. Everything else sits where it should for day 21.',
      'What each marker means at this point in your cycle, and the specific questions worth raising at your next appointment.',
    ]) expect(hits(old), old).not.toEqual([]);
    // "Ferritin is low" was false against the printed interval: 18 is within 15–150.
    expect(labIntervalPlacement(18, 15, 150)).toBe('within');
  });
});
