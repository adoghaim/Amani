import { useState } from 'react';
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, FlaskConical, Microscope } from 'lucide-react';
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
  if (confidence === 'high') return null;
  const config = {
    medium: { icon: AlertTriangle, color: 'text-theme-flag-watch',  bg: 'bg-theme-flag-watch-bg',    label: 'Review' },
    low:    { icon: AlertCircle,  color: 'text-theme-flag-low',     bg: 'bg-theme-flag-low-bg',      label: 'Low confidence' },
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
  const [expanded, setExpanded] = useState(item.confidence_score === 'low' || item.needs_review);

  const borderColor =
    item.confidence_score === 'low'
      ? 'border-theme-flag-low-border bg-theme-flag-low-bg/40'
      : item.confidence_score === 'medium'
      ? 'border-theme-flag-watch-border'
      : 'border-theme-neutral-200';

  return (
    <div className={`border rounded-lg overflow-hidden ${borderColor}`}>
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer select-none hover:bg-theme-neutral-50/50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-theme-neutral-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-theme-neutral-400 flex-shrink-0" />}
          <span className="font-medium text-theme-neutral-900 truncate">
            {item.raw_name || <span className="text-theme-neutral-400 italic">Unnamed</span>}
          </span>
          {item.canonical_slug && (
            <span className="hidden sm:inline text-xs text-theme-neutral-400">({item.canonical_slug})</span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 ml-3">
          <span className="font-semibold text-theme-neutral-900 tabular-nums">
            {item.value_text ?? item.value_numeric}
            {item.unit && <span className="text-theme-neutral-500 font-normal ml-1">{item.unit}</span>}
          </span>
          <ConfidenceBadge confidence={item.confidence_score} />
          <button
            className="text-theme-neutral-400 hover:text-theme-flag-low transition-colors ml-1"
            onClick={e => { e.stopPropagation(); onRemove(globalIndex); }}
            title="Remove"
          >
            ×
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-theme-neutral-100 bg-theme-surface">
          {item.source_snippet && (
            <div className="mt-4 p-3 bg-theme-neutral-50 rounded-lg border border-theme-neutral-200">
              <label className="block text-[10px] font-bold text-theme-neutral-400 uppercase tracking-wider mb-1">Raw report context</label>
              <p className="text-sm font-mono text-theme-neutral-700 break-words leading-relaxed">
                {item.source_snippet}
              </p>
            </div>
          )}
          
          {item.parse_error && (
            <div className="mt-3 flex items-start gap-2 bg-theme-flag-low-bg border border-theme-flag-low-border rounded-md px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-theme-flag-low flex-shrink-0 mt-0.5" />
              <p className="text-xs text-theme-flag-low font-medium">{item.parse_error} — please correct the value below.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
            <div>
              <label className="block text-xs font-medium text-theme-neutral-600 mb-1">Test Label (on report)</label>
              <input
                type="text"
                value={item.raw_name}
                onChange={e => onUpdate(globalIndex, 'raw_name', e.target.value)}
                className="w-full px-3 py-1.5 text-sm border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-flag-ok-border focus:border-theme-flag-ok-border"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-theme-neutral-600 mb-1">Map to Amani Biomarker</label>
              <select
                value={item.canonical_slug ?? ''}
                onChange={e => {
                  const slug = e.target.value || null;
                  onUpdate(globalIndex, 'canonical_slug', slug);
                  onUpdate(globalIndex, 'is_core_biomarker', slug !== null);
                  onUpdate(globalIndex, 'review_status', 'edited_by_user');
                }}
                className="w-full px-3 py-1.5 text-sm border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-flag-ok-border focus:border-theme-flag-ok-border"
              >
                <option value="">— Extended (not mapped) —</option>
                {catalogSlugs.map(b => (
                  <option key={b.slug} value={b.slug}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={`block text-xs font-medium mb-1 ${item.parse_error ? 'text-theme-flag-low' : 'text-theme-neutral-600'}`}>
                Value
              </label>
              <input
                type="number"
                step="0.001"
                value={item.value_numeric}
                onChange={e => {
                  onUpdate(globalIndex, 'value_numeric', parseFloat(e.target.value));
                  onUpdate(globalIndex, 'review_status', 'edited_by_user');
                }}
                className={`w-full px-3 py-1.5 text-sm border rounded-lg focus:ring-2 focus:ring-theme-flag-ok-border focus:border-theme-flag-ok-border ${item.parse_error ? 'border-theme-flag-low-border bg-theme-flag-low-bg' : 'border-theme-neutral-300'}`}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-theme-neutral-600 mb-1">Unit</label>
              <input
                type="text"
                value={item.unit ?? ''}
                onChange={e => onUpdate(globalIndex, 'unit', e.target.value || null)}
                placeholder="e.g. mg/dL"
                className="w-full px-3 py-1.5 text-sm border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-flag-ok-border focus:border-theme-flag-ok-border"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-theme-neutral-600 mb-1">Reference range (raw)</label>
              <input
                type="text"
                value={item.raw_reference_range ?? ''}
                onChange={e => onUpdate(globalIndex, 'raw_reference_range', e.target.value || null)}
                placeholder='e.g. "65-99"'
                className="w-full px-3 py-1.5 text-sm border border-theme-neutral-300 rounded-lg focus:ring-2 focus:ring-theme-flag-ok-border focus:border-theme-flag-ok-border"
              />
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-3 border-t border-theme-neutral-100 pt-4">
            {item.needs_review && item.review_status !== 'reviewed' && item.review_status !== 'edited_by_user' && (
              <Button 
                variant="outline" 
                size="sm" 
                className="text-xs py-1 h-8"
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate(globalIndex, 'review_status', 'reviewed');
                  onUpdate(globalIndex, 'reviewed_by_user', true);
                  onUpdate(globalIndex, 'confidence_score', 'high');
                  onUpdate(globalIndex, 'needs_review', false);
                  setExpanded(false);
                }}
              >
                Mark as Correct
              </Button>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              className="text-xs py-1 h-8 text-theme-flag-low hover:text-theme-flag-low hover:bg-theme-flag-low-bg border-theme-flag-low-border"
              onClick={(e) => { e.stopPropagation(); onRemove(globalIndex); }}
            >
              Remove Item
            </Button>
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
  const indexed = items.map((item, i) => ({ item, globalIndex: i }));
  const reviewItems = indexed.filter(({ item }) => item.needs_review);
  const coreItems = indexed.filter(({ item }) => item.is_core_biomarker && !item.needs_review);
  const extendedItems = indexed.filter(({ item }) => !item.is_core_biomarker && !item.needs_review);
  const totalCore = items.filter(i => i.is_core_biomarker).length;
  const totalExtended = items.length - totalCore;

  return (
    <div className="space-y-6">
      <div className="bg-theme-info-bg border border-theme-info-border rounded-lg px-4 py-3">
        <h3 className="font-semibold text-theme-info mb-1">
          {items.length} lab item{items.length !== 1 ? 's' : ''} extracted
        </h3>
        <p className="text-sm text-theme-info">
          {totalCore} match the Amani core panel &middot; {totalExtended} extended items saved for history.
          {reviewItems.length > 0 && <span className="text-theme-flag-watch font-medium ml-1">{reviewItems.length} need review.</span>}
        </p>
      </div>

      {reviewItems.length > 0 && (
        <section className="bg-theme-flag-watch-bg/40 border border-theme-flag-watch-border rounded-lg p-4">
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="w-5 h-5 text-theme-flag-watch flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold text-theme-flag-watch uppercase tracking-wide">
                Needs review ({reviewItems.length})
              </h3>
              <p className="text-xs text-theme-flag-watch mt-0.5">
                Confirm or fix these before saving — they'll move into your panel below as you go.
              </p>
            </div>
          </div>
          <div className="space-y-2">
            {reviewItems.map(({ item, globalIndex }) => (
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
        </section>
      )}

      {coreItems.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <FlaskConical className="w-4 h-4 text-theme-flag-ok" />
            <h3 className="text-sm font-bold text-theme-neutral-700 uppercase tracking-wide">Core Biomarkers ({coreItems.length})</h3>
            <span className="text-xs text-theme-neutral-400">Used for scoring & insights</span>
          </div>
          <div className="space-y-2">
            {catalogLoading ? (
              <p className="text-sm text-theme-neutral-400">Loading catalog...</p>
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
            <Microscope className="w-4 h-4 text-theme-info" />
            <h3 className="text-sm font-bold text-theme-neutral-700 uppercase tracking-wide group-hover:text-theme-neutral-900 transition-colors">
              Extended Lab Items ({extendedItems.length})
            </h3>
            <span className="text-xs text-theme-neutral-400">Stored for history — not used in scoring</span>
            {showExtended ? <ChevronDown className="w-4 h-4 text-theme-neutral-400 ml-auto" /> : <ChevronRight className="w-4 h-4 text-theme-neutral-400 ml-auto" />}
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
