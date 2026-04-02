import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="w-full space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-theme-text">
          {label}
        </label>
      )}
      <input
        className={`block w-full px-4 py-2 border rounded-xl shadow-sm bg-theme-surface text-theme-text placeholder-theme-muted-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-transparent transition-all sm:text-sm ${
          error
            ? 'border-theme-danger focus:ring-theme-danger'
            : 'border-theme-border'
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="text-sm text-theme-danger">{error}</p>
      )}
    </div>
  );
}
