import { useEffect, useState } from 'react';
import { isFeatureEnabled, loadRuntimeConfig } from '../lib/runtimeConfig';
import { LAB_CRITICAL_FLAG_NOTICE_FLAG } from '../lib/safety/labCriticalFlags';

/**
 * features.lab_critical_flag_notice for the report page (review F014 interim,
 * D6.2): what is known now, then the answer once this launch's runtime config
 * has loaded. Off by default; a missing key or a failed read is off.
 */
export function useLabCriticalFlagNotice(): boolean {
  const [enabled, setEnabled] = useState(() => isFeatureEnabled(LAB_CRITICAL_FLAG_NOTICE_FLAG));
  useEffect(() => {
    let live = true;
    void loadRuntimeConfig().then(() => {
      if (live) setEnabled(isFeatureEnabled(LAB_CRITICAL_FLAG_NOTICE_FLAG));
    });
    return () => {
      live = false;
    };
  }, []);
  return enabled;
}
