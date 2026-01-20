import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import type { BiomarkerName } from '../types';
import type { ExtractedBiomarker } from '../utils/biomarkerParser';

interface ReviewBiomarkersProps {
  extractedBiomarkers: ExtractedBiomarker[];
  onUpdate: (index: number, field: keyof ExtractedBiomarker, value: string | number) => void;
  onRemove: (index: number) => void;
  onAddNew: () => void;
}

const BIOMARKERS: { value: BiomarkerName; label: string; commonUnits: string[] }[] = [
  { value: 'estradiol', label: 'Estradiol', commonUnits: ['pg/mL', 'pmol/L'] },
  { value: 'progesterone', label: 'Progesterone', commonUnits: ['ng/mL', 'nmol/L'] },
  { value: 'lh', label: 'LH', commonUnits: ['mIU/mL', 'IU/L'] },
  { value: 'fsh', label: 'FSH', commonUnits: ['mIU/mL', 'IU/L'] },
  { value: 'amh', label: 'AMH', commonUnits: ['ng/mL', 'pmol/L'] },
  { value: 'tsh', label: 'TSH', commonUnits: ['mIU/L', 'μIU/mL'] },
  { value: 'free_t4', label: 'Free T4', commonUnits: ['ng/dL', 'pmol/L'] },
  { value: 'ferritin', label: 'Ferritin', commonUnits: ['ng/mL', 'μg/L'] },
  { value: 'vitamin_d', label: 'Vitamin D', commonUnits: ['ng/mL', 'nmol/L'] },
];

const ConfidenceIndicator = ({ confidence }: { confidence: 'high' | 'medium' | 'low' }) => {
  const config = {
    high: { icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50', label: 'High confidence' },
    medium: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Medium confidence' },
    low: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Low confidence - review carefully' },
  };

  const { icon: Icon, color, bg, label } = config[confidence];

  return (
    <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${bg}`}>
      <Icon className={`w-4 h-4 ${color}`} />
      <span className={`text-xs font-medium ${color}`}>{label}</span>
    </div>
  );
};

export function ReviewBiomarkers({
  extractedBiomarkers,
  onUpdate,
  onRemove,
  onAddNew,
}: ReviewBiomarkersProps) {
  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Review Extracted Biomarkers</h3>
        <p className="text-sm text-blue-700">
          We automatically extracted {extractedBiomarkers.length} biomarker{extractedBiomarkers.length !== 1 ? 's' : ''} from your lab report.
          Please review and edit as needed before submitting.
        </p>
      </div>

      {extractedBiomarkers.some(b => b.confidence === 'low') && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-900 mb-1">Review Required</h3>
              <p className="text-sm text-red-700">
                Some extracted values have low confidence. Please verify each value carefully before continuing.
                Common issues include decimal point errors (e.g., 2.1 vs 21) or misidentified reference ranges.
              </p>
            </div>
          </div>
        </div>
      )}

      {extractedBiomarkers.map((biomarker, index) => (
        <div
          key={index}
          className={`border-2 rounded-lg p-4 ${
            biomarker.confidence === 'low'
              ? 'border-red-200 bg-red-50'
              : biomarker.confidence === 'medium'
              ? 'border-amber-200 bg-amber-50'
              : 'border-gray-200'
          }`}
        >
          <div className="flex items-start justify-between mb-4">
            <ConfidenceIndicator confidence={biomarker.confidence} />
            <Button variant="danger" size="sm" onClick={() => onRemove(index)}>
              Remove
            </Button>
          </div>

          {biomarker.rawText && (
            <div className="mb-4 text-sm text-gray-600 italic">
              Original text: "{biomarker.rawText}"
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Biomarker
              </label>
              <select
                value={biomarker.name}
                onChange={(e) => onUpdate(index, 'name', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
              >
                {BIOMARKERS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Value
              </label>
              <input
                type="number"
                step="0.01"
                value={biomarker.value}
                onChange={(e) => onUpdate(index, 'value', parseFloat(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit
              </label>
              <select
                value={biomarker.unit}
                onChange={(e) => onUpdate(index, 'unit', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
              >
                {BIOMARKERS.find((b) => b.value === biomarker.name)?.commonUnits.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference Min
              </label>
              <input
                type="number"
                step="0.01"
                value={biomarker.reference_min || ''}
                onChange={(e) =>
                  onUpdate(index, 'reference_min', e.target.value ? parseFloat(e.target.value) : undefined)
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                placeholder="Optional"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reference Max
              </label>
              <input
                type="number"
                step="0.01"
                value={biomarker.reference_max || ''}
                onChange={(e) =>
                  onUpdate(index, 'reference_max', e.target.value ? parseFloat(e.target.value) : undefined)
                }
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                placeholder="Optional"
              />
            </div>
          </div>
        </div>
      ))}

      <Button variant="secondary" onClick={onAddNew}>
        Add Another Biomarker
      </Button>
    </div>
  );
}
