/**
 * Route-level loading state.
 *
 * Deliberately not a skeleton: this is the Suspense fallback for lazily-loaded
 * routes, so the shape of what's coming isn't known yet and a skeleton would
 * guess wrong. Per-surface skeletons belong inside each page, where the layout
 * is known.
 *
 * The mark is the cycle ring from the app icon, drawn once. min-h-dvh rather
 * than min-h-dvh — on iOS Safari and inside the Capacitor webview, 100vh
 * includes the browser chrome and the layout jumps when it hides.
 */
export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-dvh gap-4 bg-theme-background"
      role="status"
      aria-live="polite"
    >
      <svg
        className="w-9 h-9 animate-spin motion-reduce:animate-none text-theme-primary"
        viewBox="0 0 32 32"
        aria-hidden="true"
      >
        {/* Track and arc both derive from the token via currentColor, so the
            spinner follows the palette instead of pinning two hex literals. */}
        <circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.22" />
        <path
          d="M16 4 a12 12 0 0 1 10.4 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}
