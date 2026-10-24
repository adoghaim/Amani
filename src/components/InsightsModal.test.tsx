// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsModal } from './InsightsModal';
import { compareReports } from '../lib/scoring/compareReports';
import {
  COMPARISON_CHANGES_EMPTY, COMPARISON_CHANGES_HEADING, movementClaimsByKey, PRODUCT_DISCLAIMERS,
} from '../lib/scoring/insightCopy';
import { MODEL_CANARIES, unprovenancedText, unresolvedModelProse } from '../lib/scoring/modelProse.testkit';
import type { BiomarkerName } from '../types';

/*
  V2-03b Stage 2. The Tracker's comparison modal rendered lab-insights model
  output: a summary, per-marker "change" sentences, "may have coincided with"
  factors, an amber arrow for each increase, questions (owner R2) and next
  steps (owner R4). Turn 13 (owner R1): it lists the measured changes the app
  computed from the two reports, and a model sentence renders only where it is
  an authorized phrase of one of those claims.
*/
const claimsFor = (previous: [string, number][], current: [string, number][]) => [...movementClaimsByKey(
  compareReports(
    previous.map(([key, value]) => ({ key: key as BiomarkerName, value, unit: 'uIU/mL' })),
    current.map(([key, value]) => ({ key: key as BiomarkerName, value, unit: 'uIU/mL' })),
  ).map(d => [d.key, d] as const)).values()];
const TSH = claimsFor([['tsh', 6]], [['tsh', 9]]);

const insights = {
  summary: MODEL_CANARIES[0],
  notable_changes: [
    { biomarker: 'TSH', change: MODEL_CANARIES[1], possible_factors: [MODEL_CANARIES[2], MODEL_CANARIES[3]] },
    // Strengthening by rewording and by addition, of a claim that exists.
    { biomarker: 'TSH', change: 'Your thyroid health has worsened.', possible_factors: ['Your TSH increased from your previous result, which reflects stress.'] },
  ],
  questions_to_ask: ['Why is my thyroid getting worse?', 'Should I start treatment?', 'Why is this dangerous?'],
  next_steps_general: ['Take 2000 IU of vitamin D daily.', 'Eat more iron-rich foods.', 'Walk 30 minutes a day.'],
};

// The sheet is the shared Modal, which portals to <body>: render it for real
// and return the dialog, which holds everything the old static markup held.
let root: Root;
let app: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(() => {
  act(() => root.unmount());
  app.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(props: Partial<Parameters<typeof InsightsModal>[0]>) {
  act(() => root.render(<InsightsModal isOpen onClose={() => {}} insights={insights} {...props} />));
  return document.querySelector<HTMLElement>('[role="dialog"]')!;
}

describe('InsightsModal (owner R1, R2, R4)', () => {
  it('no model question, next step, summary, change sentence or causal factor reaches the modal', () => {
    const host = mount({ claims: TSH });
    for (const text of [...insights.questions_to_ask, ...insights.next_steps_general, 'Questions for your provider', 'General next steps',
      ...MODEL_CANARIES, 'This may have coincided with', 'Your thyroid health has worsened', 'which reflects stress']) {
      expect(host.textContent).not.toContain(text);
    }
  });

  it('states the measured change from the two reports, as the claim, with nothing unprovenanced beside it', () => {
    const host = mount({ claims: TSH });
    const surface = host.querySelector('[data-model-surface="comparison"]');
    expect(surface?.querySelectorAll('[data-language-claim="measured_movement"]')).toHaveLength(1);
    expect(surface?.textContent).toContain('TSH increased from 6 to 9 uIU/mL.');
    expect(unprovenancedText(host, [COMPARISON_CHANGES_HEADING])).toEqual([]);
    expect(unresolvedModelProse(host, TSH)).toEqual([]);
    // No valence: no flag colour and no amber arrow anywhere in the body.
    expect(host.innerHTML).not.toMatch(/flag-(?:ok|watch|low)/);
    expect(host.querySelector(`[data-language-source="product_disclaimer"]`)?.textContent).toBe(PRODUCT_DISCLAIMERS.comparison.text);
  });

  it('a model sentence that is an authorized phrase of a claim renders, marked as model-derived and resolvable', () => {
    const host = mount({ claims: TSH, insights: { ...insights, summary: 'Your TSH increased from your previous result.' } });
    const model = host.querySelectorAll('[data-model-field]');
    expect(model).toHaveLength(1);
    expect(model[0]!.getAttribute('data-model-field')).toBe('insights.summary');
    expect(model[0]!.textContent).toBe('Your TSH increased from your previous result.');
    expect(unresolvedModelProse(host, TSH)).toEqual([]);
    expect(unprovenancedText(host, [COMPARISON_CHANGES_HEADING])).toEqual([]);
  });

  it('with no claim (reports not loaded, or no change), the modal states that and renders no model text', () => {
    for (const claims of [[], claimsFor([['tsh', 6]], [['tsh', 6]])]) {
      const host = mount({ claims, insights: { ...insights, summary: 'Your TSH increased from your previous result.' } });
      expect(host.textContent).toContain(COMPARISON_CHANGES_EMPTY);
      expect(host.querySelectorAll('[data-model-field]')).toHaveLength(0);
      for (const canary of MODEL_CANARIES) expect(host.textContent).not.toContain(canary);
    }
  });

  it('negative control: the positive assertions see raw model text if it is rendered', () => {
    const host = mount({ claims: TSH });
    const leak = host.ownerDocument.createElement('li');
    leak.textContent = MODEL_CANARIES[0];
    host.querySelector('[data-model-surface="comparison"] ul')!.append(leak);
    expect(unprovenancedText(host, [COMPARISON_CHANGES_HEADING])).toEqual([`comparison: ${MODEL_CANARIES[0]}`]);
    const forged = host.ownerDocument.createElement('span');
    forged.setAttribute('data-model-field', 'insights.summary');
    forged.innerHTML = '<span data-language-claim="measured_movement" data-language-category="factual_observation" data-language-source="lab_data" data-language-cue="neutral">Your thyroid health has worsened.</span>';
    host.append(forged);
    expect(unresolvedModelProse(host, TSH)).toEqual(['insights.summary: resolves to no claim: Your thyroid health has worsened.']);
  });
});
