import { useState } from 'react';
import { MessageSquare, Copy, CheckCircle2 } from 'lucide-react';
import type { DoctorQuestion } from '../lib/insights/buildInsightSummary';

interface Props {
  questions: DoctorQuestion[];
}

export function DoctorQuestionsCard({ questions }: Props) {
  const [copied, setCopied] = useState(false);

  if (questions.length === 0) return null;

  const copyAll = () => {
    navigator.clipboard.writeText(questions.map(q => q.text).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-theme-border-subtle bg-theme-surface px-5 py-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <MessageSquare className="w-4 h-4 text-theme-primary" />
          <h3 className="text-sm text-theme-text">Questions for Your Doctor</h3>
        </div>
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 text-xs text-theme-primary hover:text-theme-primary-dark font-medium transition-colors"
        >
          {copied ? (
            <><CheckCircle2 className="w-3.5 h-3.5" /> Copied</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copy all</>
          )}
        </button>
      </div>
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-theme-neutral-50">
            <span className="text-xs font-bold text-theme-primary bg-theme-primary/10 rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
              {i + 1}
            </span>
            <p className="text-sm text-theme-text-body leading-relaxed">{q.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
