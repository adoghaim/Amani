import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const inserts: { table: string; row: unknown }[] = [];
vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: async (row: unknown) => {
        inserts.push({ table, row });
        return { error: table === 'interpretation_feedback' ? null : { message: 'unexpected table' } };
      },
    }),
  },
}));

import {
  flagsForClinicalReview, supabaseProblemReportPort, INTERPRETATION_FEEDBACK_FLAG, PROBLEM_CATEGORIES, PROBLEM_TEXT_MAX, problemReportRow,
  submitProblemReport, type InterpretationFeedbackInsert, type ProblemReportInput, type ProblemReportPort,
} from './problemReport';

/*
  PK-HARM-01 (D20): the chooser's categories, the 1,000-character cap, and the
  one row every report writes. The database side (RLS, CHECKs, the queue) is
  proven by the migration harness, cases/210-interpretation-feedback.sh.
*/

const MIGRATION = readFileSync(new URL('../../../../supabase/migrations/20261015020000_interpretation_feedback.sql', import.meta.url), 'utf8');

const input = (over: Partial<ProblemReportInput> = {}): ProblemReportInput => ({
  reportId: 'report-1', interpretationId: 'version-1', category: 'explanation', text: '', ...over,
});

function recordingPort(reply: { error: string | null } | Error = { error: null }) {
  const rows: InterpretationFeedbackInsert[] = [];
  const port: ProblemReportPort = {
    insert: vi.fn(async (row: InterpretationFeedbackInsert) => {
      rows.push(row);
      if (reply instanceof Error) throw reply;
      return reply;
    }),
  };
  return { port, rows };
}

describe('report a problem: categories and cap (D20, Q4)', () => {
  it('the chooser is D20\'s four choices, in order, in its words', () => {
    expect(PROBLEM_CATEGORIES.map(c => c.label)).toEqual([
      'A value is wrong',
      'The explanation is confusing or wrong',
      'Something here worried me',
      'Other',
    ]);
  });

  it('the categories and the cap are exactly what the database CHECKs allow', () => {
    const ids = PROBLEM_CATEGORIES.map(c => `'${c.id}'`).join(', ');
    expect(MIGRATION).toContain(`CHECK (category IN (${ids}))`);
    expect(PROBLEM_TEXT_MAX).toBe(1000);
    expect(MIGRATION).toContain(`char_length(text) <= ${PROBLEM_TEXT_MAX}`);
    expect(MIGRATION).toContain("GENERATED ALWAYS AS (category = 'worried') STORED");
  });

  it('only "Something here worried me" flags the report for the clinical reviewer', () => {
    expect(PROBLEM_CATEGORIES.filter(c => flagsForClinicalReview(c.id)).map(c => c.label)).toEqual(['Something here worried me']);
  });

  it('reads the D5 flag by its documented name', () => {
    expect(INTERPRETATION_FEEDBACK_FLAG).toBe('interpretation_feedback');
    expect(readFileSync(new URL('../../../../docs/runtime-config.md', import.meta.url), 'utf8'))
      .toContain('| `interpretation_feedback` |');
  });
});

describe('report a problem: the row', () => {
  it('sends exactly the four columns she may write; the server sets the rest', () => {
    const built = problemReportRow(input({ category: 'worried', text: '  It said something alarming.  ' }));
    expect(built).toEqual({ ok: true, row: {
      report_id: 'report-1', interpretation_version_id: 'version-1', category: 'worried', text: 'It said something alarming.',
    } });
    if (built.ok) expect(Object.keys(built.row).sort()).toEqual(['category', 'interpretation_version_id', 'report_id', 'text']);
  });

  it('blank text is sent as null, never as an empty string', () => {
    for (const text of ['', '   ', '\n\t']) {
      const built = problemReportRow(input({ text }));
      expect(built.ok && built.row.text, JSON.stringify(text)).toBeNull();
    }
  });

  it('an unknown explanation is sent as null', () => {
    const built = problemReportRow(input({ interpretationId: null }));
    expect(built.ok && built.row.interpretation_version_id).toBeNull();
    const empty = problemReportRow(input({ interpretationId: '' }));
    expect(empty.ok && empty.row.interpretation_version_id).toBeNull();
  });

  it('1,000 characters are accepted; 1,001 are refused, not cut', () => {
    expect(problemReportRow(input({ text: 'x'.repeat(1000) })).ok).toBe(true);
    expect(problemReportRow(input({ text: 'x'.repeat(1001) }))).toEqual({ ok: false, problem: 'text_too_long' });
    // Surrounding whitespace does not count.
    expect(problemReportRow(input({ text: ` ${'x'.repeat(1000)} ` })).ok).toBe(true);
  });

  it('refuses an unknown category and a missing report', () => {
    expect(problemReportRow(input({ category: 'alarming' as never }))).toEqual({ ok: false, problem: 'unknown_category' });
    expect(problemReportRow(input({ reportId: '' }))).toEqual({ ok: false, problem: 'no_report' });
  });
});

describe('report a problem: submitting', () => {
  it.each(PROBLEM_CATEGORIES.map(c => c.id))('every category writes its one row (%s)', async category => {
    const { port, rows } = recordingPort();
    expect(await submitProblemReport(port, input({ category }))).toEqual({ ok: true });
    expect(rows).toEqual([expect.objectContaining({ category, report_id: 'report-1' })]);
  });

  it('a refused or failed write is not_saved, and never throws', async () => {
    expect(await submitProblemReport(recordingPort({ error: 'new row violates row-level security policy' }).port, input()))
      .toEqual({ ok: false, reason: 'not_saved' });
    expect(await submitProblemReport(recordingPort(new Error('offline')).port, input()))
      .toEqual({ ok: false, reason: 'not_saved' });
  });

  it('nothing is written when the input is refused', async () => {
    const { port, rows } = recordingPort();
    expect(await submitProblemReport(port, input({ text: 'x'.repeat(1001) }))).toEqual({ ok: false, reason: 'text_too_long' });
    expect(rows).toEqual([]);
  });
});

describe('report a problem: the app port', () => {
  it('inserts the one row into interpretation_feedback and reads nothing back', async () => {
    inserts.length = 0;
    const result = await submitProblemReport(supabaseProblemReportPort, input({ category: 'value_wrong', text: 'Ferritin says 45' }));
    expect(result).toEqual({ ok: true });
    expect(inserts).toEqual([{ table: 'interpretation_feedback', row: {
      report_id: 'report-1', interpretation_version_id: 'version-1', category: 'value_wrong', text: 'Ferritin says 45',
    } }]);
  });
});
