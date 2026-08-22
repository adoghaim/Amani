interface CardProps {
  children: React.ReactNode;
  className?: string;
  /**
   * Cards default to a flat surface. Elevation is opt-in because it should mean
   * something — a card that floats above the page is claiming priority over the
   * cards that don't. Border + shadow on everything, which is where this
   * component started, says nothing at all.
   */
  elevated?: boolean;
  /** Renders as <article> for cards that stand alone as a unit of content. */
  as?: 'div' | 'article' | 'section';
}

export function Card({ children, className = '', elevated = false, as: Tag = 'div' }: CardProps) {
  return (
    <Tag
      className={[
        'bg-theme-surface rounded-2xl p-6 border',
        elevated
          ? 'border-theme-border-subtle shadow-theme'
          : 'border-theme-border-inner shadow-none',
        className,
      ].join(' ')}
    >
      {children}
    </Tag>
  );
}
