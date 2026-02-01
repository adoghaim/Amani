interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', ...props }: InputProps) {
  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-theme-text mb-2">
          {label}
        </label>
      )}
      <input
        className={`w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-theme-primary focus:border-transparent transition-all ${
          error ? 'border-theme-danger' : 'border-theme-border'
        } ${className}`}
        {...props}
      />
      {error && (
        <p className="mt-1 text-sm text-theme-danger">{error}</p>
      )}
    </div>
  );
}
