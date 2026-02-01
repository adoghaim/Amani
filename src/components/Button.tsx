interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonProps) {
  const baseStyles = 'font-medium rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm';

  const variants = {
    primary: 'bg-theme-primary hover:bg-theme-primary-dark text-white',
    secondary: 'bg-theme-surface-2 hover:bg-theme-border text-theme-text border border-theme-border',
    danger: 'bg-theme-danger hover:bg-red-700 text-white',
    ghost: 'bg-transparent hover:bg-theme-surface-2 text-theme-muted-text',
  };

  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
