import React, { useId } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Renders the value in the data face with tabular figures. Use for any
   *  measurement — lab values, cycle lengths — so digits align and 0/O and
   *  1/l are unambiguous. */
  numeric?: boolean;
}

export function Input({
  label, error, hint, numeric = false, className = '', id, ...props
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-theme-text mb-1.5">
          {label}
        </label>
      )}
      <input
        id={inputId}
        // min-h-[44px] is the iOS minimum comfortable tap target. The previous
        // py-2 gave ~36px, which is a miss on a phone more often than not.
        className={[
          'block w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border bg-theme-surface',
          'text-theme-text placeholder:text-theme-muted-text-3',
          'transition-shadow duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary focus-visible:border-theme-primary',
          numeric ? 'font-mono tabular-nums' : '',
          error
            ? 'border-theme-flag-low focus-visible:ring-theme-flag-low'
            : 'border-theme-border hover:border-theme-primary-faded',
          className,
        ].join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-theme-muted-text-2">{hint}</p>
      )}
      {error && (
        <p id={errorId} className="mt-1.5 text-sm text-theme-flag-low">{error}</p>
      )}
    </div>
  );
}
