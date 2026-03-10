import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import type { ExtractedBiomarker } from '../utils/biomarkerParser';
import { useBiomarkerCatalog } from '../hooks/useBiomarkerCatalog';

interface ReviewBiomarkersProps {
  extractedBiomarkers: ExtractedBiomarker[];
  onUpdate: (index: number, field: keyof ExtractedBiomarker, value: string | number) => void;
  onRemove: (index: number) => void;
  onAddNew: () => void;
}

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
  const { catalog, loading } = useBiomarkerCatalog();

  const unitsForSlug = (slug: string): string[] => {
    const entry = catalog.find(b => b.slug === slug);
    return entry ? [entry.unit] : [''];
  };

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

      {extractedBiomarkers.map((biomarker, index) => {
        const units = unitsForSlug(biomarker.name);
        return (
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

            {biomarker.rawValue && (
              <div className="mb-4 text-xs text-gray-500">
                Raw value on report: <span className="font-mono font-medium">{biomarker.rawValue}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Biomarker
                </label>
                {loading ? (
                  <div className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm">
                    Loading...
                  </div>
                ) : (
                  <select
                    value={biomarker.name}
                    onChange={(e) => onUpdate(index, 'name', e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                  >
                    {!catalog.find(b => b.slug === biomarker.name) && (
                      <option value={biomarker.name}>{biomarker.name} (unknown)</option>
                    )}
                    {catalog.map((b) => (
                      <option key={b.slug} value={b.slug}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Value
                </label>
                <input
                  type="number"
                  step="0.001"
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
                  value={biomarker.unit ?? ''}
                  onChange={(e) => onUpdate(index, 'unit', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                >
                  {biomarker.unit && !units.includes(biomarker.unit) && (
                    <option value={biomarker.unit}>{biomarker.unit}</option>
                  )}
                  {units.map((unit) => (
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
                  value={biomarker.reference_min ?? ''}
                  onChange={(e) =>
                    onUpdate(index, 'reference_min', e.target.value ? parseFloat(e.target.value) : undefined as any)
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
                  value={biomarker.reference_max ?? ''}
                  onChange={(e) =>
                    onUpdate(index, 'reference_max', e.target.value ? parseFloat(e.target.value) : undefined as any)
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>
        );
      })}

      <Button variant="secondary" onClick={onAddNew}>
        Add Another Biomarker
      </Button>
    </div>
  );
}
