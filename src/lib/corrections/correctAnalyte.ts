/**
 * Saving a correction (PK-CORRECT-01; D20, R17): the one write path, the
 * correct_analyte RPC (20261015100000). It appends a row to
 * analyte_corrections; the saved reading is never overwritten.
 */
import { supabase } from '../supabase';

export interface CorrectionRequest {
  reportAnalyteId: string;
  value: number;
  rawText: string;
  unit: string | null;
  /** The recomputed flag for a value with a biomarkers row, else null. */
  flag: string | null;
}

export type CorrectionResult = { ok: true; correctedAt: string | null } | { ok: false };

/** Where a correction is written; tests pass a fake. */
export interface CorrectionPort {
  correctAnalyte(request: CorrectionRequest): Promise<CorrectionResult>;
}

export const supabaseCorrectionPort: CorrectionPort = {
  async correctAnalyte(request) {
    try {
      const { data, error } = await supabase.rpc('correct_analyte', {
        p_report_analyte_id: request.reportAnalyteId,
        p_value: request.value,
        p_raw_text: request.rawText,
        p_unit: request.unit,
        p_flag: request.flag,
      });
      if (error) return { ok: false };
      const correctedAt = data && typeof data === 'object' && typeof (data as { created_at?: unknown }).created_at === 'string'
        ? (data as { created_at: string }).created_at
        : null;
      return { ok: true, correctedAt };
    } catch {
      return { ok: false };
    }
  },
};
