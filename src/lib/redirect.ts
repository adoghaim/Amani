export const DEFAULT_REDIRECT = '/app'

/**
 * Clamp an untrusted `?redirect=` value to an internal path.
 *
 * Every hop here is load-bearing, in order:
 *
 * - **Decode first.** The guard has to judge what the browser will ultimately
 *   navigate to, not the encoded form an attacker hands us. Decoding loops
 *   (bounded) because `%252f` decodes to `%2f` and only then to `/`.
 * - **Reject control characters.** Browsers strip tab, LF and CR while parsing
 *   a URL, so a path of "/<tab>/evil.com" is parsed as "//evil.com" —
 *   protocol-relative, and off-origin.
 * - **Reject backslashes.** The URL parser normalises `\` to `/`, so
 *   "/\evil.com" also becomes "//evil.com". Verified in node:
 *   `new URL('/\\evil.com', 'https://amanibiometrics.com').href` is
 *   `https://evil.com/`. This is the hole in the original copy of this guard in
 *   App.tsx, which only rejected a leading "//".
 * - **Require a single leading slash, and no `:` or `@`.** Blocks absolute URLs
 *   (`https://evil.com`), scheme-relative ones, and userinfo tricks
 *   (`/@evil.com`).
 *
 * Anything that fails falls back to `/app` rather than throwing — a bad
 * redirect param should land a signed-in user on her dashboard, not an error.
 */
export function safeRedirectTarget(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT

  let target = raw
  for (let i = 0; i < 3; i++) {
    let decoded: string
    try {
      decoded = decodeURIComponent(target)
    } catch {
      // Malformed percent-escape — not a path we are willing to navigate to.
      return DEFAULT_REDIRECT
    }
    if (decoded === target) break
    target = decoded
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(target)) return DEFAULT_REDIRECT
  if (target.includes('\\')) return DEFAULT_REDIRECT
  if (!target.startsWith('/') || target.startsWith('//')) return DEFAULT_REDIRECT
  if (target.includes(':') || target.includes('@')) return DEFAULT_REDIRECT

  return target
}
