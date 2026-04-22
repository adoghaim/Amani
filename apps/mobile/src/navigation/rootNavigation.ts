import {
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from '@react-navigation/native';

const MAIN_TABS_ROUTE = 'MainTabs';
const TAB_ROUTE_NAMES = new Set(['Dashboard', 'Tracker', 'ReportsList', 'Settings']);

export const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
  createNavigationContainerRef<ParamListBase>();

export function navigate(name: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) {
    return;
  }

  if (TAB_ROUTE_NAMES.has(name)) {
    (navigationRef as any).navigate(MAIN_TABS_ROUTE, {
      screen: name,
      params,
    });
    return;
  }

  if (params) {
    (navigationRef as any).navigate(name, params);
    return;
  }

  (navigationRef as any).navigate(name);
}
