/**
 * Amani's mark: a cycle ring with an arc for elapsed days and a dot on today.
 *
 * Deliberately not a heart. Every health app is a heart, and a heart says
 * nothing about what this one does — reading results against where someone is
 * in their cycle. Same geometry as the favicon and the dashboard dial, so the
 * icon, the marketing site and the product all resolve to one idea.
 */
export function CycleMark({ className = 'w-6 h-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.22" />
      <path
        d="M16 6 a10 10 0 0 1 8.6 15.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="24.6" cy="21.2" r="3" fill="currentColor" />
    </svg>
  );
}
