import type { ComponentType } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { User } from '../../../types';

/**
 * What every Settings section component receives. The page renders them only
 * once both are loaded, so a component never handles a missing user or profile.
 */
export interface SettingsSectionProps {
  user: SupabaseUser;
  userProfile: User;
}

/** The five Settings sections, in the fixed D25 order. */
export const SETTINGS_SECTION_ORDER = ['account', 'health-profile', 'reminders', 'privacy-security', 'your-data'] as const;
export type SettingsSectionId = typeof SETTINGS_SECTION_ORDER[number];

/** One component on the page, inside its section. */
export interface SettingsEntry {
  /** Stable, unique key across the page. */
  id: string;
  Component: ComponentType<SettingsSectionProps>;
}

/** One D25 section: its name and its components, top to bottom. */
export interface SettingsSection {
  id: SettingsSectionId;
  /** The section's name. Assistive technology announces it; it is not drawn. */
  title: string;
  entries: readonly SettingsEntry[];
}
