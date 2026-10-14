import { useEffect, useState } from 'react';
import { isFeatureEnabled, loadRuntimeConfig } from '../lib/runtimeConfig';
import { FIRST_PARTY_EVENTS_FLAG } from '../lib/firstPartyEvents';

/**
 * features.first_party_events for a component (PK-EXP5, D6.2): what is known
 * now, then the answer once this launch's runtime config has loaded. Off by
 * default; a missing key or a failed read is off.
 */
export function useFirstPartyEventsEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => isFeatureEnabled(FIRST_PARTY_EVENTS_FLAG));
  useEffect(() => {
    let live = true;
    void loadRuntimeConfig().then(() => {
      if (live) setEnabled(isFeatureEnabled(FIRST_PARTY_EVENTS_FLAG));
    });
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
