import { Card } from '../../../components/Card';
import { ShieldCheck, Lock } from 'lucide-react';

export function PrivacySection() {
  return (
    <Card className="border-theme-flag-ok-border bg-theme-flag-ok-bg/40">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-theme-flag-ok-bg rounded-full flex items-center justify-center flex-shrink-0">
          <ShieldCheck className="w-5 h-5 text-theme-flag-ok" />
        </div>
        <div>
          <h2 className="text-lg text-theme-neutral-900 mb-1">
            Data Privacy & Security
          </h2>
          <p className="text-sm text-theme-neutral-600 leading-relaxed">
            Your data is protected with account-based access controls and encryption in
            transit. Only you can access your lab results and health information — no other
            user or third party can view your data.
          </p>
          <div className="mt-3 flex items-center gap-2 text-xs text-theme-flag-ok font-medium">
            <Lock className="w-3.5 h-3.5" />
            <span>All data is scoped to your account and encrypted in transit</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
