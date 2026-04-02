import { useState } from 'react';
import { AlertCircle, CheckCircle, AlertTriangle, ChevronDown, ChevronRight, FlaskConical, Microscope } from 'lucide-react';
import { Button } from './Button';
import type { ReportItem } from '../utils/biomarkerParser';
import { useBiomarkerCatalog } from '../hooks/useBiomarkerCatalog';

interface ReviewBiomarkersProps {
  items: ReportItem[];
  onUpdate: (index: number, field: keyof ReportItem, value: string | number | null | boolean) => void;
  onRemove: (index: number) => void;
  onAddNew: () => void;
}

const ConfidenceBadge = ({ confidence }: { confidence: 'high' | 'medium' | 'low' }) => {
  const config = {
    high:   { icon: CheckCircle,  color: 'text-emerald-600', bg: 'bg-emerald-50',  label: 'High' },
    medium: { icon: AlertTriangle, color: 'text-amber-600',  bg: 'bg-amber-50',    label: 'Review' },
    low:    { icon: AlertCircle,  color: 'text-red-600',     bg: 'bg-red-50',      label: 'Low confidence' },
  };
  const { icon: Icon, color, bg, label } = config[confidence];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bg} ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
};



function ItemCard({
  item,
  globalIndex,
  onUpdate,
  onRemove,
  catalogSlugs,
}: {
  item: ReportItem;
  globalIndex: number;
  onUpdate: ReviewBiomarkersProps['onUpdate'];
  onRemove: ReviewBiomarkersProps['onRemove'];
  catalogSlugs: { slug: string; name: string; unit: string }[];
}) {
  const [expanded, setExpanded] = useState(item.confidence_score === 'low');

  const borderColor =
    item.confidence_score === 'low'
      ? 'border-red-200 bg-red-50/40'
      : item.confidence_score === 'medium'
      ? 'border-amber-200'
      : 'border-gray-200';

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
          <span className="font-medium text-gray-900 truncate">
            {item.raw_name || <span className="text-gray-400 italic">Unnamed</span>}
          </span>
          {item.canonical_slug && (
            <span className="hidden sm:inline text-xs text-gray-400">({item.canonical_slug})</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
          <span className="font-semibold text-gray-900 tabular-nums">
            {item.value_text ?? item.value_numeric}
            {item.unit && <span className="text-gray-500 font-normal ml-1">{item.unit}</span>}
          </span>
          <ConfidenceBadge confidence={item.confidence_score} />
          <button
            className="text-gray-400 hover:text-red-500 transition-colors ml-1"
            onClick={e => { e.stopPropagation(); onRemove(globalIndex); }}
            title="Remove"
          >
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-white">
          {item.source_snippet && (
            <p className="mt-3 text-xs text-gray-400 italic truncate">Source: "{item.source_snippet}"</p>
          )}
          {item.parse_error && (
            <div className="mt-2 flex items-start gap-2 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 font-medium">{item.parse_error} — please correct the value below.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Test name</label>
              <input
                type="text"
                value={item.raw_name}
                onChange={e => onUpdate(globalIndex, 'raw_name', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Map to core biomarker</label>
              <select
                value={item.canonical_slug ?? ''}
                onChange={e => {
                  const slug = e.target.value || null;
                  onUpdate(globalIndex, 'canonical_slug', slug);
                  onUpdate(globalIndex, 'is_core_biomarker', slug !== null);
                }}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">— Extended (not mapped) —</option>
                {catalogSlugs.map(b => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1 ${item.parse_error ? 'text-red-600' : 'text-gray-600'}`}>
                Value{item.parse_error ? ' (likely incorrect)' : ''}
              </label>
              <input
                type="number"
                step="0.001"
                value={item.value_numeric}
                onChange={e => onUpdate(globalIndex, 'value_numeric', parseFloat(e.target.value))}
                className={`w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 ${item.parse_error ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unit</label>
              <input
                type="text"
                value={item.unit ?? ''}
                onChange={e => onUpdate(globalIndex, 'unit', e.target.value || null)}
                placeholder="e.g. mg/dL"
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Reference range (raw)</label>
              <input
                type="text"
                value={item.raw_reference_range ?? ''}
                onChange={e => onUpdate(globalIndex, 'raw_reference_range', e.target.value || null)}
                placeholder='e.g. "65-99" or "<200"'
                className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>

            {item.normalized_reference_min != null || item.normalized_reference_max != null ? (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ref min</label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.normalized_reference_min ?? ''}
                    onChange={e => onUpdate(globalIndex, 'normalized_reference_min', e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ref max</label>
                  <input
                    type="number"
                    step="0.01"
                    value={item.normalized_reference_max ?? ''}
                    onChange={e => onUpdate(globalIndex, 'normalized_reference_max', e.target.value ? parseFloat(e.target.value) : null)}
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
                    placeholder="Optional"
                  />
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewBiomarkers({ items, onUpdate, onRemove, onAddNew }: ReviewBiomarkersProps) {
  const { catalog, loading: catalogLoading } = useBiomarkerCatalog();
  const [showExtended, setShowExtended] = useState(true);

  const catalogSlugs = catalog.map(b => ({ slug: b.slug, name: b.name, unit: b.unit }));
  const coreItems = items.map((item, i) => ({ item, globalIndex: i })).filter(({ item }) => item.is_core_biomarker);
  const extendedItems = items.map((item, i) => ({ item, globalIndex: i })).filter(({ item }) => !item.is_core_biomarker);
  const needsReview = items.filter(i => i.needs_review).length;

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
        <h3 className="font-semibold text-blue-900 mb-1">
          {items.length} lab item{items.length !== 1 ? 's' : ''} extracted
        </h3>
        <p className="text-sm text-blue-700">
          {coreItems.length} match the Amani core panel &middot; {extendedItems.length} extended items saved for history.
          {needsReview > 0 && <span className="text-amber-700 font-medium ml-1">{needsReview} need review.</span>}
        </p>
      </div>

      {needsReview > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            Some items have low extraction confidence — missing units or unusual values. Review them before submitting.
          </p>
        </div>
      )}

      {coreItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FlaskConical className="w-4 h-4 text-emerald-600" />
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Core Biomarkers ({coreItems.length})</h3>
            <span className="text-xs text-gray-400">Used for scoring & insights</span>
          </div>
          <div className="space-y-2">
            {catalogLoading ? (
              <p className="text-sm text-gray-400">Loading catalog...</p>
            ) : (
              coreItems.map(({ item, globalIndex }) => (
                <ItemCard
                  key={globalIndex}
                  item={item}
                  globalIndex={globalIndex}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  catalogSlugs={catalogSlugs}
                />
              ))
            )}
          </div>
        </section>
      )}

      {extendedItems.length > 0 && (
        <section>
          <button
            className="flex items-center gap-2 mb-3 group w-full text-left"
            onClick={() => setShowExtended(v => !v)}
          >
            <Microscope className="w-4 h-4 text-blue-500" />
            <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide group-hover:text-gray-900 transition-colors">
              Extended Lab Items ({extendedItems.length})
            </h3>
            <span className="text-xs text-gray-400">Stored for history — not used in scoring</span>
            {showExtended ? <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />}
          </button>

          {showExtended && (
            <div className="space-y-2">
              {extendedItems.map(({ item, globalIndex }) => (
                <ItemCard
                  key={globalIndex}
                  item={item}
                  globalIndex={globalIndex}
                  onUpdate={onUpdate}
                  onRemove={onRemove}
                  catalogSlugs={catalogSlugs}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <Button variant="secondary" size="sm" onClick={onAddNew}>
        + Add lab item manually
      </Button>
    </div>
  );
}
