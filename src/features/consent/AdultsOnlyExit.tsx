import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { FullScreenGate } from '../../components/FullScreenGate';
import { UNDER_18_EXIT } from './consentCopy';

/**
 * D13: "Amani is for adults 18 and over. We've removed your account." Shown
 * after the account has been erased and she has been signed out, so it renders
 * from this navigation's local state only: nothing is read, and a direct visit
 * (no state) goes to the start page instead of claiming a removal.
 */
export function AdultsOnlyExit() {
  const location = useLocation();
  const navigate = useNavigate();
  const removed = (location.state as { accountRemoved?: unknown } | null)?.accountRemoved === true;
  if (!removed) return <Navigate to="/" replace />;
  return (
    <FullScreenGate
      heading={UNDER_18_EXIT.heading}
      sentence={UNDER_18_EXIT.sentence}
      primary={{ label: UNDER_18_EXIT.primary, onClick: () => navigate('/', { replace: true }) }}
    />
  );
}
