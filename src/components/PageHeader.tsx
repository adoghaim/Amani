/**
 * The heading block every /app page opens with.
 *
 * These were five different treatments — text-2xl, text-3xl and text-4xl, each
 * with its own weight and spacing — so moving between pages felt like moving
 * between apps. One component, one rhythm.
 */
export function PageHeader({
  title, description, action,
}: {
  title: string;
  description?: string;
  /** Primary action for the page, right-aligned on wide screens. */
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl leading-tight">{title}</h1>
        {description && (
          <p className="text-sm text-theme-muted-text-2 mt-1.5 max-w-prose">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
