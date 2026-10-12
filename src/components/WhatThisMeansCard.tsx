import { FileText } from 'lucide-react';
import type { TopFinding, BiggestChange } from '../lib/insights/buildInsightSummary';

interface Props {
  aiText?: string;
  topFindings: TopFinding[];
  biggestChanges: BiggestChange[];
}

function buildFallbackText(topFindings: TopFinding[], biggestChanges: BiggestChange[]): string {
  const outOfRange = topFindings.filter(f => f.status === 'out_of_range');
  const borderline = topFindings.filter(f => f.status === 'borderline');
  const improved = biggestChanges.filter(c => c.boundaryCrossing?.direction === 'improved');
  const worsened = biggestChanges.filter(c => c.boundaryCrossing?.direction === 'worsened');

  if (outOfRange.length === 0 && borderline.length === 0) {
    if (improved.length > 0) {
      const names = improved.slice(0, 2).map(c => c.displayName).join(' and ');
      return `Your panel looks solid overall, with ${names} showing improvement since your last draw. The trend is moving in a positive direction.`;
    }
    return `All measured values are within Amani's context bands, which are still under review. This is a useful baseline to track over time.`;
  }

  const topName = outOfRange[0]?.displayName ?? borderline[0]?.displayName;

  if (improved.length > 0 && outOfRange.length > 0 && improved[0]) {
    const improvedName = improved[0].displayName;
    return `${topName} remains the primary area to keep an eye on, while ${improvedName} has shown improvement since your last report. The picture is mixed but moving in a constructive direction.`;
  }

  if (improved.length > 0 && borderline.length > 0 && outOfRange.length === 0) {
    const names = improved.slice(0, 2).map(c => c.displayName).join(' and ');
    return `${topName} is near the edge of the Amani band, though ${names} ${improved.length === 1 ? 'has' : 'have'} improved. The overall trend is positive.`;
  }

  if (worsened.length > 0 && outOfRange.length > 0 && worsened[0]) {
    return `${topName} is the priority finding here, and ${worsened[0].displayName} has shifted since your last draw. Tracking both at your next panel will help clarify the direction.`;
  }

  if (outOfRange.length >= 2) {
    const names = outOfRange.slice(0, 2).map(f => f.displayName).join(' and ');
    return `${names} are both outside the Amani band and are the two findings most worth discussing with your provider.`;
  }

  if (outOfRange.length === 1 && borderline.length > 0 && borderline[0]) {
    const borderName = borderline[0].displayName;
    return `${topName} is outside the Amani band and is the top priority. ${borderName} is borderline — worth monitoring, but not urgent on its own.`;
  }

  if (outOfRange.length === 1) {
    return `${topName} is the standout finding in this report. The rest of the panel is within range, which provides helpful context for tracking over time.`;
  }

  return `${topName} is the primary item to keep an eye on. Continue tracking these markers to see how the trend develops.`;
}

export function WhatThisMeansCard({ aiText, topFindings, biggestChanges }: Props) {
  const text = aiText ?? buildFallbackText(topFindings, biggestChanges);
  const hasAI = !!aiText;

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-7 h-7 rounded-lg bg-theme-primary/10 flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4 text-theme-primary" />
          </div>
          <h2 className="text-sm text-theme-text">Interpretation</h2>
          {hasAI && (
            <span className="ml-auto text-xs font-medium text-theme-muted-text-2 tracking-wide">
              AI Analysis
            </span>
          )}
        </div>
        <p className="text-[15px] text-theme-text leading-[1.7] font-normal">{text}</p>
      </div>
    </div>
  );
}
