import { PersonalContextCard } from '../PersonalContextCard';
import { AccountSection } from './AccountSection';
import { DeleteAccountSection } from './DeleteAccountSection';
import { PrivacySection } from './PrivacySection';
import { RemindersSection } from './RemindersSection';
import type { SettingsSection } from './types';

export type { SettingsSection, SettingsSectionProps } from './types';

/**
 * The Settings page, top to bottom (PK-INT-01, owner decision D3). The page
 * mounts exactly this list, in this order, and nothing else.
 *
 * Adding Settings UI: write a section component in this directory that takes
 * SettingsSectionProps (or no props) and renders its own Card, then add one
 * entry here where it belongs on the page.
 */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'account', Component: AccountSection },
  { id: 'personal-context', Component: PersonalContextCard },
  { id: 'reminders', Component: RemindersSection },
  { id: 'privacy', Component: PrivacySection },
  { id: 'delete-account', Component: DeleteAccountSection },
];
