import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  // active:scale gives the press a physical response — without it a tap on
  // device feels like nothing happened until the next screen paints.
  // motion-reduce opts out for anyone who asked the OS to stop animations.
  const baseStyles =
    'inline-flex items-center justify-center font-medium rounded-xl transition-all duration-200 ' +
    'active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-none ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-theme-background ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 shadow-theme-sm';

  const variants = {
    primary:
      'bg-theme-primary hover:bg-theme-primary-dark text-white focus-visible:ring-theme-primary',
    secondary:
      'bg-theme-surface-2 hover:bg-theme-surface-hover text-theme-text border border-theme-border focus-visible:ring-theme-primary',
    danger:
      'bg-theme-danger hover:bg-theme-danger-dark text-white focus-visible:ring-theme-danger',
    ghost:
      'bg-transparent hover:bg-theme-surface-2 text-theme-muted-text shadow-none focus-visible:ring-theme-primary',
    outline:
      'border border-theme-border text-theme-text bg-theme-surface hover:bg-theme-surface-2 focus-visible:ring-theme-primary',
  };

  /*
    Every control gets a 44px tap area (D23, DESIGN.md `touch-target`).
    md is 44px tall. sm keeps its smaller look, about 32px, and an invisible
    ::before at least 44px each way, centred on the button, takes the taps the
    size gives up. lg is already over 44px.
  */
  const sizes = {
    sm: 'px-3 py-1.5 text-sm relative before:absolute before:left-1/2 before:top-1/2 ' +
      'before:h-[max(100%,44px)] before:w-[max(100%,44px)] before:-translate-x-1/2 before:-translate-y-1/2',
    md: 'px-4 py-2 text-base min-h-[44px]',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
