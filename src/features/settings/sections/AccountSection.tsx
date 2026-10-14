import { Card } from '../../../components/Card';
import type { SettingsSectionProps } from './types';

export function AccountSection({ user, userProfile }: SettingsSectionProps) {
  return (
    <Card>
      <h2 className="text-xl text-theme-neutral-900 mb-4">Account information</h2>
      <div className="space-y-3">
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Email:</span>
          <p className="text-theme-neutral-900">{user.email}</p>
        </div>
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Member Since:</span>
          <p className="text-theme-neutral-900">
            {new Date(userProfile.created_at).toLocaleDateString('en-US', {
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
          </p>
        </div>
        <div>
          <span className="text-sm font-medium text-theme-neutral-700">Subscription Status:</span>
          <p className="text-theme-neutral-900 capitalize">{userProfile.subscription_status}</p>
        </div>
      </div>
    </Card>
  );
}
