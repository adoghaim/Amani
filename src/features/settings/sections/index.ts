import { PersonalContextCard } from '../PersonalContextCard';
import { AccountSection } from './AccountSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { DeviceLockSection } from './DeviceLockSection';
import { PrivacySection } from './PrivacySection';
import { RemindersSection } from './RemindersSection';
import { SETTINGS_SECTION_ORDER, type SettingsSection } from './types';

export { SETTINGS_SECTION_ORDER } from './types';
export type { SettingsEntry, SettingsSection, SettingsSectionId, SettingsSectionProps } from './types';

/** Always the last thing on the page (D25). */
export const DELETE_MY_DATA_ENTRY_ID = 'delete-my-data';

/**
 * The Settings page, top to bottom (PK-INT-01: D3, D25). The page mounts
 * exactly these five sections in this order, each with its components in
 * order, and nothing else:
 *
 *   1. Account          name, email, subscription link, sign out
 *   2. Health profile   health context, then the women's health profile (D22)
 *   3. Reminders        including the denied-permission state (D14)
 *   4. Privacy & security  consent status and withdrawal, the Face ID lock,
 *                       re-lock timing (D16)
 *   5. Your data        Download my data (D27), then Delete my data, last
 *
 * Adding Settings UI: write a section component in this directory that takes
 * SettingsSectionProps (or no props) and renders its own Card, then add one
 * entry to the section it belongs to, at its place. Download my data
 * (PK-EXPORT-01) goes before Delete my data, which stays last.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'account', title: 'Account', entries: [{ id: 'account-information', Component: AccountSection }] },
  { id: 'health-profile', title: 'Health profile', entries: [{ id: 'personal-context', Component: PersonalContextCard }] },
  { id: 'reminders', title: 'Reminders', entries: [{ id: 'reminder-preferences', Component: RemindersSection }] },
  { id: 'privacy-security', title: 'Privacy & security', entries: [
    { id: 'data-privacy', Component: PrivacySection },
    // PK-DEVICE-01: the Face ID / fingerprint lock and re-lock timing (D16). Phones only.
    { id: 'device-lock', Component: DeviceLockSection },
  ] },
  { id: 'your-data', title: 'Your data', entries: [{ id: DELETE_MY_DATA_ENTRY_ID, Component: DeleteAccountSection }] },
];

/** Why a section list breaks the D25 order; empty when it holds. */
export function settingsOrderProblems(sections: readonly SettingsSection[]): string[] {
  const problems: string[] = [];
  const ids = sections.map(section => section.id);
  if (ids.join() !== SETTINGS_SECTION_ORDER.join()) {
    problems.push(`sections are ${ids.join(', ')}; D25 is ${SETTINGS_SECTION_ORDER.join(', ')}`);
  }
  const entries = sections.flatMap(section => section.entries.map(entry => entry.id));
  for (const id of new Set(entries)) {
    if (entries.indexOf(id) !== entries.lastIndexOf(id)) problems.push(`${id} is listed twice`);
  }
  for (const section of sections) {
    if (section.entries.length === 0) problems.push(`${section.id} has no entries`);
  }
  const yourData = sections.find(section => section.id === 'your-data')?.entries ?? [];
  if (yourData[yourData.length - 1]?.id !== DELETE_MY_DATA_ENTRY_ID || entries[entries.length - 1] !== DELETE_MY_DATA_ENTRY_ID) {
    problems.push(`${DELETE_MY_DATA_ENTRY_ID} must be the last entry, in Your data`);
  }
  return problems;
}
