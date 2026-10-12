import type { CyclePhase } from '../types';

/**
 * Phase presentation, shared by the dial, the summary header and anywhere else
 * a phase is shown. Kept out of the component file so Fast Refresh keeps
 * working, and in one place so a phase never gets a different colour on two
 * different screens.
 */
export const PHASE_STYLE: Record<CyclePhase | 'unknown', { arc: string; text: string; surface: string; note: string }> = {
  menstrual:  { arc: 'text-theme-phase-menstrual',  text: 'text-theme-phase-menstrual',  surface: 'bg-theme-phase-menstrual-bg',  note: 'Hormones are at their lowest.' },
  follicular: { arc: 'text-theme-phase-follicular', text: 'text-theme-phase-follicular', surface: 'bg-theme-phase-follicular-bg', note: 'Estrogen is climbing.' },
  ovulatory:  { arc: 'text-theme-phase-ovulatory',  text: 'text-theme-phase-ovulatory',  surface: 'bg-theme-phase-ovulatory-bg',  note: 'Estrogen peaks and LH surges.' },
  luteal:     { arc: 'text-theme-phase-luteal',     text: 'text-theme-phase-luteal',     surface: 'bg-theme-phase-luteal-bg',     note: 'Progesterone is at its highest.' },
  // Pregnancy is not a cycle, so the dial reads as trimester progress instead
  // of cycle day. Handled explicitly rather than falling through to 'unknown',
  // which would tell a pregnant user their cycle could not be placed.
  // V2-03b: "Many ranges shift in pregnancy" was pregnancy guidance with no
  // authorizing source; the note states the trimester only.
  pregnancy_t1: { arc: 'text-theme-phase-follicular', text: 'text-theme-phase-follicular', surface: 'bg-theme-phase-follicular-bg', note: 'First trimester.' },
  pregnancy_t2: { arc: 'text-theme-phase-ovulatory',  text: 'text-theme-phase-ovulatory',  surface: 'bg-theme-phase-ovulatory-bg',  note: 'Second trimester.' },
  pregnancy_t3: { arc: 'text-theme-phase-luteal',     text: 'text-theme-phase-luteal',     surface: 'bg-theme-phase-luteal-bg',     note: 'Third trimester.' },
  unknown:    { arc: 'text-theme-muted-text-3',     text: 'text-theme-muted-text',       surface: 'bg-theme-surface-2',           note: 'Log a period to place your cycle.' },
};

export const PHASE_LABEL: Record<CyclePhase | 'unknown', string> = {
  menstrual: 'Menstrual phase',
  follicular: 'Follicular phase',
  ovulatory: 'Ovulatory phase',
  luteal: 'Luteal phase',
  pregnancy_t1: 'First trimester',
  pregnancy_t2: 'Second trimester',
  pregnancy_t3: 'Third trimester',
  unknown: 'Cycle unknown',
};


export function phaseLabel(phase: CyclePhase | 'unknown') {
  return PHASE_LABEL[phase] ?? PHASE_LABEL.unknown;
}

export function phaseStyle(phase: CyclePhase | 'unknown') {
  return PHASE_STYLE[phase] ?? PHASE_STYLE.unknown;
}
