import type { ComponentType } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { User } from '../../../types';

/**
 * What every Settings section receives. The page renders sections only once
 * both are loaded, so a section never handles a missing user or profile.
 */
export interface SettingsSectionProps {
  user: SupabaseUser;
  userProfile: User;
}

/** One entry in the ordered list the Settings page mounts (./index.ts). */
export interface SettingsSection {
  /** Stable, unique key. */
  id: string;
  Component: ComponentType<SettingsSectionProps>;
}
