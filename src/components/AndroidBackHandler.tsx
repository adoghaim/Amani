import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { isNative, onBackButton } from '../lib/native';
import { deviceLock } from '../lib/deviceLock';
import { closeTopOverlay } from '../lib/overlayStack';

// Routes where back leaves the app instead of navigating to a blank state.
const ROOT_ROUTES = ['/app', '/login', '/signup', '/', '/pricing', '/success', '/reset-password'];

/**
 * The Android hardware back button. In order: the biometric lock closes the app
 * (PK-DEVICE-01: never the page under the lock); an open sheet closes first
 * (review F067: back used to exit the app from /app with a sheet open and
 * discard her entry); a root route exits; anything else navigates back.
 *
 * It goes through `onBackButton`, which removes a listener released before the
 * plugin loaded; a direct import of the Capacitor app plugin here did not.
 */
export function AndroidBackHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!isNative()) return;

    return onBackButton(({ canGoBack, exitApp }) => {
      if (deviceLock.getState().locked) {
        exitApp();
        return;
      }
      if (closeTopOverlay()) return;
      if (ROOT_ROUTES.includes(location.pathname) || !canGoBack) {
        exitApp();
      } else {
        navigate(-1);
      }
    });
  }, [location.pathname, navigate]);

  return null;
}
