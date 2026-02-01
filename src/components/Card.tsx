interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps) {
  return (
    <div className={`bg-theme-surface rounded-2xl shadow-sm border border-theme-border p-6 ${className}`}>
      {children}
    </div>
  );
}
