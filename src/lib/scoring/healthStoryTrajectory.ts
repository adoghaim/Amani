import type { BiggestChange } from '../insights/buildInsightSummary';
import type { HealthStory, PrimaryContext } from '../insights/buildHealthStory';
import type { TrajectoryStatus } from './compareReports';
import { reviewStatement, type AuthorizedLanguage } from './insightCopy';

/*
  V2-03 amendment 5. The health story's trajectory for the primary finding.
  R1's neutral statuses used to fall through a default branch to 'unchanged',
  so TSH 9 -> 6 against a DISPUTED band read "is unchanged from your prior
  report". Every status is handled explicitly and the switch is exhaustive: a
  new status fails typecheck instead of falling through. 'unchanged' is said
  only when the value did not move; 'improving' only when the band authorizes
  a favourable direction.
*/
export function primaryTrajectory(
  change: BiggestChange | undefined,
  language: AuthorizedLanguage,
): PrimaryContext['trajectory'] {
  if (!change || change.isFirstRecorded || change.previousValue === null) return 'no_prior_data';
  const moved = change.previousValue !== change.currentValue;
  const towardBand = language.favourableDirection ? 'improving' : 'changed';

  switch (change.boundaryCrossing?.direction) {
    case undefined: break;
    case 'worsened': return 'worsening';
    case 'improved': return towardBand;
    // 'changed', and any direction this code does not know, describes a movement.
    default: return 'changed';
  }

  const status: TrajectoryStatus = change.trajectoryStatus;
  switch (status) {
    case 'improving_still_high':
    case 'improving_still_low':
    case 'normalized':
      return towardBand;
    case 'worsening_still_high':
    case 'worsening_still_low':
    case 'newly_abnormal':
      return 'worsening';
    case 'changed_into_band':
    case 'changed_still_high':
    case 'changed_still_low':
      return 'changed';
    case 'stable_abnormal':
    case 'stable_normal':
    case null:
      return moved ? 'changed' : 'unchanged';
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/**
 * A 'changed' trajectory is followed by the band's review statement, as on the
 * trajectory card, so the story never leaves an unreviewed movement unqualified.
 */
export function withBandReview(
  story: HealthStory,
  trajectory: PrimaryContext['trajectory'] | null | undefined,
  language: AuthorizedLanguage,
): HealthStory {
  if (trajectory !== 'changed') return story;
  const i = story.sentences.findIndex(s => s.kind === 'theme');
  if (i < 0) return story;
  const sentences = [...story.sentences];
  sentences.splice(i + 1, 0, { kind: 'theme', text: reviewStatement(language) });
  return { sentences };
}
