import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import {
  AGE_RANGES,
  SEX_OPTIONS,
  PREGNANCY_OPTIONS,
  HEALTH_GOALS,
} from '../onboarding/contextOptions';
import {
  ChipInput,
  SelectField,
  GoalsChips,
} from '../onboarding/contextInputs';

interface FormState {
  full_name: string | null;
  age_range: string | null;
  sex_at_birth: string | null;
  pregnancy_status: string | null;
  health_goals: string[];
  symptoms: string[];
  supplements: string[];
  known_conditions: string[];
}

const buildInitialState = (
  userProfile: ReturnType<typeof useAuth>['userProfile']
): FormState => ({
  full_name: userProfile?.full_name ?? null,
  age_range: userProfile?.age_range ?? null,
  sex_at_birth: userProfile?.sex_at_birth ?? null,
  pregnancy_status: userProfile?.pregnancy_status ?? null,
  health_goals: userProfile?.health_goals ?? [],
  symptoms: userProfile?.symptoms ?? [],
  supplements: userProfile?.supplements ?? [],
  known_conditions: userProfile?.known_conditions ?? [],
});

export function PersonalContextCard() {
  const { user, userProfile, refreshUserProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => buildInitialState(userProfile));

  const update = <K extends keyof FormState>(key: K, next: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: next }));
  };

  const handleEdit = () => {
    setForm(buildInitialState(userProfile));
    setError(null);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          full_name: form.full_name,
          age_range: form.age_range,
          sex_at_birth: form.sex_at_birth,
          pregnancy_status: form.pregnancy_status,
          health_goals: form.health_goals,
          symptoms: form.symptoms,
          supplements: form.supplements,
          known_conditions: form.known_conditions,
        })
        .eq('id', user.id);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      await refreshUserProfile();
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-theme-surface-2 rounded-full flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-theme-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="text-lg font-semibold text-theme-text">Personal Context</h2>
            {saved && !editing && (
              <span className="flex items-center gap-1.5 text-sm text-[#2F8F6B] font-medium">
                <Check className="w-4 h-4" />
                Saved
              </span>
            )}
          </div>
          <p className="text-sm text-theme-muted-text leading-relaxed">
            Amani uses this context to make your lab explanations more helpful. This does not
            replace medical advice.
          </p>

          {!editing && (() => {
            const name = userProfile?.full_name?.trim() || null;
            const goals = userProfile?.health_goals ?? [];
            const symptoms = userProfile?.symptoms ?? [];
            const supplements = userProfile?.supplements ?? [];
            const conditions = userProfile?.known_conditions ?? [];

            const countParts: string[] = [];
            if (symptoms.length > 0) {
              countParts.push(`${symptoms.length} ${symptoms.length === 1 ? 'symptom' : 'symptoms'}`);
            }
            if (supplements.length > 0) {
              countParts.push(`${supplements.length} ${supplements.length === 1 ? 'supplement' : 'supplements'}`);
            }
            if (conditions.length > 0) {
              countParts.push(`${conditions.length} ${conditions.length === 1 ? 'condition' : 'conditions'}`);
            }

            const hasAnyContext =
              !!name || goals.length > 0 || countParts.length > 0;

            return (
              <>
                {hasAnyContext ? (
                  <dl className="mt-4 space-y-1.5 text-sm">
                    {name && (
                      <div className="flex flex-wrap gap-1.5">
                        <dt className="text-theme-muted-text">Name:</dt>
                        <dd className="text-theme-text">{name}</dd>
                      </div>
                    )}
                    {goals.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <dt className="text-theme-muted-text">Goals:</dt>
                        <dd className="text-theme-text">{goals.join(', ')}</dd>
                      </div>
                    )}
                    {countParts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <dt className="text-theme-muted-text">Context added:</dt>
                        <dd className="text-theme-text">{countParts.join(', ')}</dd>
                      </div>
                    )}
                  </dl>
                ) : (
                  <p className="mt-3 text-sm text-theme-muted-text leading-relaxed">
                    Add details like your goals, symptoms, supplements, and health context so
                    Amani can personalize explanations.
                  </p>
                )}
                <div className="mt-4">
                  <Button variant="outline" size="sm" onClick={handleEdit}>
                    Edit Context
                  </Button>
                </div>
              </>
            );
          })()}
        </div>
      </div>

      {editing && (
        <div className="mt-5 pt-5 border-t border-theme-border space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="w-full space-y-1">
              <label className="block text-sm font-medium text-theme-text">Preferred name</label>
              <input
                type="text"
                value={form.full_name ?? ''}
                onChange={(e) => update('full_name', e.target.value || null)}
                placeholder="e.g. Sarah"
                className="block w-full px-3 py-1.5 border border-theme-border rounded-xl shadow-sm bg-theme-surface text-theme-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-transparent transition-all text-sm"
              />
            </div>
            <SelectField
              label="Age range"
              value={form.age_range}
              options={AGE_RANGES}
              placeholder="Select age range"
              onChange={(v) => update('age_range', v)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <SelectField
              label="Sex at birth"
              value={form.sex_at_birth}
              options={SEX_OPTIONS}
              placeholder="Select"
              onChange={(v) => update('sex_at_birth', v)}
            />
            <SelectField
              label="Reproductive status"
              value={form.pregnancy_status}
              options={PREGNANCY_OPTIONS}
              placeholder="Select"
              onChange={(v) => update('pregnancy_status', v)}
            />
          </div>

          <div className="w-full space-y-1.5">
            <label className="block text-sm font-medium text-theme-text">Health goals</label>
            <GoalsChips
              options={HEALTH_GOALS}
              values={form.health_goals}
              onChange={(v) => update('health_goals', v)}
            />
          </div>

          <ChipInput
            label="Anything you want Amani to keep in mind?"
            placeholder="e.g. fatigue"
            values={form.symptoms}
            onChange={(v) => update('symptoms', v)}
          />

          <ChipInput
            label="Supplements or medications, optional"
            placeholder="e.g. vitamin D"
            values={form.supplements}
            onChange={(v) => update('supplements', v)}
          />

          <ChipInput
            label="Known conditions, optional"
            placeholder="e.g. PCOS"
            values={form.known_conditions}
            onChange={(v) => update('known_conditions', v)}
          />

          {error && (
            <div className="text-sm text-theme-flag-low bg-theme-flag-low-bg border border-theme-flag-low-border rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              loading={saving}
            >
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
