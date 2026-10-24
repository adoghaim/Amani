import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { findTextViolations } from '../../../supabase/functions/_shared/nutrient-policy';
import { SafetyWarnings } from '../../components/SafetyWarnings';
import { parseAllReportItems } from '../../utils/parser/pipeline';
import { getAllEntries } from '../biomarkers/dictionary';
import { normalizeReportItems } from '../biomarkers/normalizeReportItems';
import { authorizedLanguage, labCriticalFlagNotice, labCriticalFlagWarnings, unauthorizedClaims } from '../scoring/insightCopy';
import {
  criticalMarker, findLabCriticalFlags, LAB_CRITICAL_FLAG_NOTICE_FLAG, LAB_CRITICAL_FLAG_RULE, LAB_CRITICAL_MARKERS,
  printedCriticalMarker, type CriticalFlagAnalyte,
} from './labCriticalFlags';

/*
  Review F014, the interim (not PK-05-B): the lab's own printed critical or
  panic flag, recognised deterministically, becomes one fixed safety notice.
  No Amani threshold, range or band is involved. Every lab line below is
  synthetic.
*/

describe('the rule identity and its switch', () => {
  it('carries a rule id and version for audit, and a runtime flag name the owner switches (off until then)', () => {
    expect(LAB_CRITICAL_FLAG_RULE).toEqual({ ruleId: 'lab-printed-critical-flag', version: '1' });
    expect(Object.isFrozen(LAB_CRITICAL_FLAG_RULE)).toBe(true);
    expect(LAB_CRITICAL_FLAG_NOTICE_FLAG).toBe('lab_critical_flag_notice');
    // D5: a flag ships with its row in the runtime-config register, in the same change.
    expect(readFileSync(new URL('../../../docs/runtime-config.md', import.meta.url), 'utf8'))
      .toContain('| `lab_critical_flag_notice` |');
  });

  it('the marker table is exactly the explicit critical/panic markers, frozen', () => {
    expect(LAB_CRITICAL_MARKERS.map(m => m.marker)).toEqual(['HH', 'LL', 'CRIT', 'CRITICAL', 'PANIC', 'ALERT']);
    expect(Object.isFrozen(LAB_CRITICAL_MARKERS)).toBe(true);
  });
});

describe('criticalMarker: one printed token', () => {
  it.each([
    ['HH', 'HH'], ['LL', 'LL'], ['(HH)', 'HH'], ['(LL)', 'LL'], ['HH*', 'HH'], ['(LL)*', 'LL'],
    ['CRIT', 'CRIT'], ['Crit', 'CRIT'], ['crit', 'CRIT'], ['(CRIT)', 'CRIT'],
    ['CRITICAL', 'CRITICAL'], ['Critical', 'CRITICAL'], ['critical', 'CRITICAL'], ['Critical*', 'CRITICAL'],
    ['PANIC', 'PANIC'], ['Panic', 'PANIC'], ['(Panic)', 'PANIC'],
    ['ALERT', 'ALERT'], ['Alert', 'ALERT'], ['alert*', 'ALERT'],
  ])('%s is the critical marker %s', (token, marker) => {
    expect(criticalMarker(token)).toBe(marker);
  });

  it.each([
    // The ordinary flag family is never critical.
    'H', 'L', '(H)', '(L)', 'H*', 'L*', 'A', '(A)', 'High', 'HIGH', 'Low', 'LOW', 'Abnormal', 'ABN', 'N', 'Normal',
    '*', '**', '!', '!!',
    // Letter flags count only in capitals, as resultRow.printedLabFlag reads them.
    'hh', 'll', 'Hh',
    // Not a marker this rule knows (each needs its own review first).
    'AA', 'C', 'CH', 'CL', 'HHH', 'LLL', 'Critical-High', 'Alerted', 'Panicked',
    // Units and numbers.
    'mmol/L', 'L/min', '6.8', '3.5-5.1', '', undefined, null,
  ])('%j is not a critical marker', token => {
    expect(criticalMarker(token)).toBeNull();
  });
});

describe('printedCriticalMarker: read beside the value, where printedLabFlag reads the lab\'s flag', () => {
  it.each([
    ['Quest column order', 'Potassium 6.8 HH 3.5-5.3 mmol/L', '6.8', ['mmol/L'], { marker: 'HH', printed: 'HH' }],
    ['a word flag', 'Potassium, Serum 6.8 Critical mmol/L 3.5-5.2', '6.8', ['mmol/L'], { marker: 'CRITICAL', printed: 'Critical' }],
    ['parenthesised', 'Hemoglobin 6.1 (LL) g/dL 11.1-15.9', '6.1', ['g/dL'], { marker: 'LL', printed: '(LL)' }],
    ['after the unit', 'Potassium 6.8 mmol/L HH 3.5-5.1', '6.8', ['mmol/L'], { marker: 'HH', printed: 'HH' }],
    ['after the unit, printed in another case', 'Glucose 30 mg/dl LL 70-99', '30', ['mg/dL'], { marker: 'LL', printed: 'LL' }],
    ['after a known unit not saved on the row', 'Glucose 450 mg/dL Panic 65-99', '450', [], { marker: 'PANIC', printed: 'Panic' }],
    ['glued to the value', 'Potassium 6.8HH mmol/L 3.5-5.1', '6.8', ['mmol/L'], { marker: 'HH', printed: 'HH' }],
    ['glued to the value, parenthesised', 'Hemoglobin 6.1(LL) g/dL 11.1-15.9', '6.1', ['g/dL'], { marker: 'LL', printed: '(LL)' }],
    ['after a unit glued to the value', 'Glucose 450mg/dL Panic 65-99', '450', ['mg/dL'], { marker: 'PANIC', printed: 'Panic' }],
    ['a name that holds the same number', 'CA 125 125 HH 0.0-35.0 U/mL', '125', ['U/mL'], { marker: 'HH', printed: 'HH' }],
    ['a censored value', 'Platelets <10 CRIT x10E3/uL 150-450', '<10', ['x10E3/uL'], { marker: 'CRIT', printed: 'CRIT' }],
  ] as const)('%s', (_, snippet, value, units, expected) => {
    expect(printedCriticalMarker(snippet, value, units)).toEqual(expected);
  });

  it.each([
    ['an ordinary L', 'Ferritin 18 L 16-154 ng/mL', '18', ['ng/mL']],
    ['an ordinary (H)', 'TSH 4.85 (H) mIU/L 0.40-4.50', '4.85', ['mIU/L']],
    ['no flag', 'Glucose 94 mg/dL 70-99', '94', ['mg/dL']],
    ['a unit that reads like a flag letter', 'Volume 5 L 1-10', '5', ['L']],
    ['a marker after the range, not beside the value', 'Potassium 6.8 mmol/L 3.5-5.1 HH', '6.8', ['mmol/L']],
    ['a marker before the value', 'Potassium HH 6.8 mmol/L 3.5-5.1', '6.8', ['mmol/L']],
    ['a word that is not a unit between value and marker', 'Potassium 6.8 serum HH', '6.8', ['mmol/L']],
    ['a lab comment on a later line', 'Potassium 6.8 mmol/L 3.5-5.1 Critical value called to clinic', '6.8', ['mmol/L']],
    ['the value is not on the line', 'Potassium 6.9 HH 3.5-5.3 mmol/L', '6.8', ['mmol/L']],
    ['a glued number that only starts with the value', 'Potassium 6.85HH mmol/L', '6.8', ['mmol/L']],
    ['an ordinary flag after a unit glued to the value', 'Glucose 110mg/dL H 65-99', '110', ['mg/dL']],
    ['a name that holds the same number, with an ordinary flag', 'CA 125 125 H 0.0-35.0 U/mL', '125', ['U/mL']],
    ['a manually added row', 'Manually added', '6.8', ['mmol/L']],
  ] as const)('none for %s', (_, snippet, value, units) => {
    expect(printedCriticalMarker(snippet, value, units)).toBeNull();
  });

  it('none without a printed line or a value', () => {
    expect(printedCriticalMarker(null, '6.8', [])).toBeNull();
    expect(printedCriticalMarker('Potassium 6.8 HH', null, [])).toBeNull();
    expect(printedCriticalMarker('Potassium 6.8 HH', '  ', [])).toBeNull();
    expect(printedCriticalMarker('', '6.8', [])).toBeNull();
  });
});

const row = (over: Partial<CriticalFlagAnalyte> & Pick<CriticalFlagAnalyte, 'id' | 'source_snippet'>): CriticalFlagAnalyte => ({
  raw_name: 'potassium', display_name: 'Potassium', raw_value_text: '6.8', value_numeric: 6.8, unit: 'mmol/L', ...over,
});

describe('findLabCriticalFlags: one finding per result her lab printed a critical flag beside', () => {
  const rows: CriticalFlagAnalyte[] = [
    row({ id: 'k', source_snippet: 'Potassium 6.8 HH 3.5-5.3 mmol/L' }),
    row({ id: 'f', raw_name: 'ferritin', display_name: 'Ferritin', raw_value_text: '18', value_numeric: 18, unit: 'ng/mL', source_snippet: 'Ferritin 18 L 16-154 ng/mL' }),
    // No display name saved: the printed label names it, as the result row does.
    row({ id: 'g', raw_name: 'Glucose, Plasma', display_name: null, raw_value_text: null, value_numeric: 450, unit: 'mg/dL', source_snippet: 'Glucose, Plasma 450 Panic mg/dL 65-99' }),
    row({ id: 'm', source_snippet: 'Manually added' }),
  ];

  it('names each flagged result, with the marker as printed and the rule id and version', () => {
    expect(findLabCriticalFlags(rows)).toEqual([
      { ruleId: 'lab-printed-critical-flag', version: '1', analyteId: 'k', name: 'Potassium', marker: 'HH', printed: 'HH' },
      { ruleId: 'lab-printed-critical-flag', version: '1', analyteId: 'g', name: 'Glucose, Plasma', marker: 'PANIC', printed: 'Panic' },
    ]);
    expect(findLabCriticalFlags([])).toEqual([]);
  });

  it('is deterministic: the same rows always give the same findings, and the rows are never changed', () => {
    const frozen = rows.map(r => Object.freeze({ ...r }));
    const first = findLabCriticalFlags(frozen);
    const snapshot = JSON.stringify(first);
    expect(first).toHaveLength(2);
    for (let i = 0; i < 50; i++) {
      // Interleaved calls on other input leave no state behind.
      findLabCriticalFlags([row({ id: `x${i}`, source_snippet: `Potassium 6.8 ${i % 2 ? 'LL' : 'L'}` })]);
      const again = findLabCriticalFlags(frozen);
      expect(again).not.toBe(first);
      expect(JSON.stringify(again)).toBe(snapshot);
    }
    // A copy of the same rows gives the same findings, and no later call changed an earlier result.
    expect(JSON.stringify(findLabCriticalFlags(rows.map(r => ({ ...r }))))).toBe(snapshot);
    expect(JSON.stringify(first)).toBe(snapshot);
    expect(frozen).toEqual(rows);
  });

  it('reads the parser\'s own output: the saved line and value text are where the lab\'s flag is', () => {
    const text = [
      'Quest Diagnostics',
      'Test Name Result Flag Reference Range Units',
      'Potassium 6.8 HH 3.5-5.3 mmol/L',
      'Glucose 35 LL 65-99 mg/dL',
      'Ferritin 18 L 16-154 ng/mL',
      'Calcium 14.2 CRIT 8.6-10.4 mg/dL',
      'Sodium 118 Alert 135-146 mmol/L',
      'TSH 2.85 0.40-4.50 mIU/L',
    ].join('\n');
    // Each parsed item as NewReport saves it to report_analytes (its analyteInserts mapping).
    const saved = normalizeReportItems(parseAllReportItems(text)).map((item): CriticalFlagAnalyte => ({
      id: item.canonical_slug ?? item.raw_name,
      raw_name: item.raw_biomarker_name ?? item.raw_name,
      display_name: item._display_name ?? null,
      raw_value_text: item.value_text ?? null,
      value_numeric: item.value_numeric,
      unit: item._normalized_unit ?? item.unit ?? null,
      unit_original: item.unit_original ?? item.unit,
      source_snippet: item.source_snippet ?? null,
    }));
    expect(findLabCriticalFlags(saved).map(f => [f.analyteId, f.marker, f.printed])).toEqual([
      ['potassium', 'HH', 'HH'], ['fasting_glucose', 'LL', 'LL'], ['calcium', 'CRIT', 'CRIT'], ['sodium', 'ALERT', 'Alert'],
    ]);
  });
});

describe('the notice: fixed words in the safety channel', () => {
  const finding = (name: string) => ({ ...LAB_CRITICAL_FLAG_RULE, analyteId: name, name, marker: 'HH', printed: 'HH' });

  it('one result: one critical warning carrying the rule id and version', () => {
    expect(labCriticalFlagWarnings([finding('Potassium')])).toEqual([{
      category: 'safety_warning', cue: 'critical',
      text: 'Your lab marked your Potassium result as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.',
      authority: { kind: 'deterministic_safety_rule', ruleId: 'lab-printed-critical-flag', version: '1' },
    }]);
  });

  it('several results: still one notice, naming each result once in the lab\'s order', () => {
    const [warning] = labCriticalFlagWarnings([finding('Potassium'), finding('Glucose'), finding('Potassium'), finding('Sodium')]);
    expect(warning!.text).toBe('Your lab marked your Potassium, Glucose and Sodium results as critical. Contact your clinician promptly. If you feel unwell, call your local emergency number.');
    expect(labCriticalFlagWarnings([finding('Potassium'), finding('Glucose')])[0]!.text)
      .toMatch(/^Your lab marked your Potassium and Glucose results as critical\. /);
    expect(labCriticalFlagWarnings([])).toEqual([]);
  });

  it('only the names reach the words: the marker, printed token and row change nothing', () => {
    const a = labCriticalFlagWarnings([{ ...finding('Potassium'), marker: 'PANIC', printed: '(Panic)', analyteId: 'z' }]);
    expect(a).toEqual(labCriticalFlagWarnings([finding('Potassium')]));
  });

  it('passes the clinical language checks for every catalog result name: no diagnosis, advice, dose or judgement', () => {
    // The guardrail's own text checks (NUTRIENT_GUIDELINES.md, _shared/nutrient-policy.ts) and the band policy's claim checks.
    const NOT_SAFETY_COPY = /diagnos|disease|disorder|syndrome|deficien|insufficien|failure|\byou have\b|\btreat|medicat|prescri|\bdos(?:e|age|ing)\b|supplement|\btake\b|\bstop\b|\bstart\b|\bmg\b|\bnormal\b|abnormal|optimal|healthy|better|worse|worr|danger|serious|severe|\bfine\b|\bgood\b|\bbad\b|reassur|nothing to|\brisk\b/i;
    const names = getAllEntries().map(e => e.displayName);
    expect(names.length).toBeGreaterThan(50);
    for (const text of [labCriticalFlagNotice(['Potassium']), ...names.map(n => labCriticalFlagNotice([n])), labCriticalFlagNotice(names)]) {
      expect(findTextViolations(text), text).toEqual([]);
      expect(unauthorizedClaims(text, authorizedLanguage(null)), text).toEqual([]);
      expect(text.replace(/Your lab marked your .* results? as critical\./, ''), text).not.toMatch(NOT_SAFETY_COPY);
    }
    // Negative control: the checks do see advice and judgement.
    expect(findTextViolations('Take 500 mg of potassium daily.')).not.toEqual([]);
    expect('This is a serious result; take your medication.').toMatch(NOT_SAFETY_COPY);
  });

  it('renders through the safety channel\'s own renderer, as an alert in the critical style', () => {
    const html = renderToStaticMarkup(createElement(SafetyWarnings, { warnings: labCriticalFlagWarnings([finding('Potassium')]) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-safety-rule="lab-printed-critical-flag"');
    expect(html).toContain('data-language-cue="critical"');
    expect(html).toMatch(/flag-low/);
    expect(html).toContain('Your lab marked your Potassium result as critical.');
  });
});
