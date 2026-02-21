import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label className="block text-sm font-medium text-theme-text">
          {label}
        </label>
      )}
      <input
        className={`block w-full px-3 py-2 border border-theme-border rounded-lg shadow-sm bg-theme-surface text-theme-text placeholder-theme-muted-text focus:outline-none focus:ring-2 focus:ring-theme-primary focus:border-theme-primary sm:text-sm ${
          error ? 'border-red-300 focus:ring-red-500 focus:border-red-500' : ''
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}