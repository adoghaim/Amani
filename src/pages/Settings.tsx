import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { SETTINGS_SECTIONS } from '../features/settings/sections';

/**
 * The Settings page is an ordered list of section components
 * (src/features/settings/sections). Add Settings UI there, not here.
 */
export function Settings() {
  const { user, userProfile } = useAuth();

  if (!user || !userProfile) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-theme-neutral-600">Loading...</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto">
        <PageHeader title="Settings" description="Your account, notifications and data." />

        <div className="space-y-6">
          {SETTINGS_SECTIONS.map(({ id, Component }) => (
            <Component key={id} user={user} userProfile={userProfile} />
          ))}
        </div>
      </div>
    </Layout>
  );
}
