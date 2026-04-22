import {
  createNavigationContainerRef,
  type NavigationContainerRefWithCurrent,
  type ParamListBase,
} from '@react-navigation/native';

export const navigationRef: NavigationContainerRefWithCurrent<ParamListBase> =
  createNavigationContainerRef<ParamListBase>();

export function navigate(name: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) {
    return;
  }

  if (params) {
    (navigationRef as any).navigate(name, params);
    return;
  }

  (navigationRef as any).navigate(name);
}
