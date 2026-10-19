import { useState } from 'react';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';
import { Intervention, InterventionCategory } from '../types';
import { formatDate } from '../utils/formatters';

interface InterventionsProps {
  interventions: Intervention[];
  onAdd: (intervention: Omit<Intervention, 'id' | 'user_id' | 'created_at'>) => Promise<void>;
  onUpdate: (id: string, intervention: Partial<Intervention>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const CATEGORIES: { value: InterventionCategory; label: string }[] = [
  { value: 'supplement', label: 'Supplement' },
  { value: 'diet', label: 'Diet' },
  { value: 'exercise', label: 'Exercise' },
  { value: 'medication', label: 'Medication' },
  { value: 'sleep', label: 'Sleep' },
  { value: 'other', label: 'Other' },
];

const getCategoryColor = (category: InterventionCategory): string => {
  const colors = {
    supplement: 'bg-theme-cat-sleep-bg text-theme-cat-sleep',
    diet: 'bg-theme-flag-ok-bg text-theme-flag-ok',
    exercise: 'bg-theme-info-bg text-theme-info',
    medication: 'bg-theme-flag-low-bg text-theme-flag-low',
    sleep: 'bg-theme-cat-sleep-bg text-theme-cat-sleep',
    other: 'bg-theme-neutral-100 text-theme-neutral-800',
  };
  return colors[category];
};

export function Interventions({ interventions, onAdd, onUpdate, onDelete }: InterventionsProps) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showFirstInterventionMessage, setShowFirstInterventionMessage] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    category: 'supplement' as InterventionCategory,
    start_date: '',
    end_date: '',
    notes: '',
  });

  const resetForm = () => {
    setFormData({
      title: '',
      category: 'supplement',
      start_date: '',
      end_date: '',
      notes: '',
    });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title || !formData.start_date) return;

    try {
      const isFirstIntervention = !editingId && interventions.length === 0;

      if (editingId) {
        await onUpdate(editingId, {
          title: formData.title,
          category: formData.category,
          start_date: formData.start_date,
          end_date: formData.end_date || null,
          notes: formData.notes || null,
        });
      } else {
        await onAdd({
          title: formData.title,
          category: formData.category,
          start_date: formData.start_date,
          end_date: formData.end_date || null,
          notes: formData.notes || null,
        });

        if (isFirstIntervention) {
          setShowFirstInterventionMessage(true);
          setTimeout(() => setShowFirstInterventionMessage(false), 8000);
        }
      }
      resetForm();
    } catch (error) {
      console.error('Error saving intervention:', error);
    }
  };

  const handleEdit = (intervention: Intervention) => {
    setFormData({
      title: intervention.title,
      category: intervention.category,
      start_date: intervention.start_date,
      end_date: intervention.end_date || '',
      notes: intervention.notes || '',
    });
    setEditingId(intervention.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this intervention?')) {
      await onDelete(id);
    }
  };

  const sortedInterventions = [...interventions].sort(
    (a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime()
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg text-theme-neutral-900">Interventions</h3>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Add Intervention
          </Button>
        )}
      </div>

      {showFirstInterventionMessage && (
        <div className="bg-theme-flag-ok-bg border border-theme-flag-ok-border rounded-lg p-4">
          <p className="text-sm font-medium text-theme-flag-ok">
            We'll track how this overlaps with future labs.
          </p>
          <p className="text-xs text-theme-flag-ok mt-1">
            Your intervention will appear in the timeline alongside your lab results.
          </p>
        </div>
      )}

      {showForm && (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h4 className="font-medium text-theme-neutral-900">
                {editingId ? 'Edit Intervention' : 'New Intervention'}
              </h4>
              <button
                type="button"
                onClick={resetForm}
                className="text-theme-neutral-400 hover:text-theme-neutral-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <Input
              label="Title"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Magnesium glycinate"
              required
            />

            <div>
              <label className="block text-sm font-medium text-theme-neutral-700 mb-1">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value as InterventionCategory })
                }
                className="w-full px-3 py-2 border border-theme-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-theme-flag-ok-border"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start Date"
                type="date"
                value={formData.start_date}
                onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                required
              />
              <Input
                label="End Date (optional)"
                type="date"
                value={formData.end_date}
                onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-theme-neutral-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-theme-neutral-300 rounded-md focus:outline-none focus:ring-2 focus:ring-theme-flag-ok-border"
                placeholder="Any additional details..."
              />
            </div>

            <div className="flex gap-2">
              <Button type="submit">
                {editingId ? 'Update' : 'Add'} Intervention
              </Button>
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {sortedInterventions.length === 0 ? (
        <Card>
          <div className="text-center py-8 text-theme-neutral-600">
            <p className="mb-2">No interventions tracked yet</p>
            <p className="text-sm">Add an intervention to track what changed between labs</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedInterventions.map((intervention) => (
            <Card key={intervention.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-medium text-theme-neutral-900">{intervention.title}</h4>
                    <span
                      className={`px-2 py-1 text-xs font-medium rounded ${getCategoryColor(
                        intervention.category
                      )}`}
                    >
                      {intervention.category}
                    </span>
                  </div>
                  <div className="text-sm text-theme-neutral-600">
                    <span>Started {formatDate(intervention.start_date)}</span>
                    {intervention.end_date ? (
                      <span> • Ended {formatDate(intervention.end_date)}</span>
                    ) : (
                      <span> • Ongoing</span>
                    )}
                  </div>
                  {intervention.notes && (
                    <p className="text-sm text-theme-neutral-600 mt-2">{intervention.notes}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(intervention)}
                    className="text-theme-neutral-400 hover:text-theme-flag-ok"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(intervention.id)}
                    className="text-theme-neutral-400 hover:text-theme-flag-low"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
