import { Layout } from '../components/Layout';
import { PageHeader } from '../components/PageHeader';
import { useAuth } from '../contexts/AuthContext';
import { SETTINGS_SECTIONS } from '../features/settings/sections';

/**
 * The Settings page is the five D25 sections, each an ordered list of section
 * components (src/features/settings/sections). Add Settings UI there, not here.
 * A section is a named region for assistive technology and draws nothing of
 * its own, so the cards keep their spacing. A section whose components all
 * render nothing (Reminders, while features.local_reminders is off) is hidden,
 * so assistive technology does not announce an empty region.
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
          {SETTINGS_SECTIONS.map(section => (
            <section key={section.id} aria-label={section.title} data-settings-section={section.id} className="space-y-6 empty:hidden">
              {section.entries.map(({ id, Component }) => (
                <Component key={id} user={user} userProfile={userProfile} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </Layout>
  );
}
