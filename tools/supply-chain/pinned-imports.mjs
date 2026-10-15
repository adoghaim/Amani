/*
  Pure rules for "is this edge-function import pinned?" (PK-SUPPLY-01).

  Supabase deploys each edge function by resolving its remote imports at
  deploy time. A range such as `npm:@supabase/supabase-js@2` or
  `npm:zod@^3.25.76` lets production code change on the next deploy without a
  commit. Every remote specifier must therefore name one exact version.

  Remote = `npm:`, `jsr:`, `http://`, `https://`. Relative paths, `node:`
  built-ins and bare specifiers (resolved by an import map, which is checked
  with the same rule) are not remote.

  No I/O here: check-pinned-imports.mjs walks the tree and the test drives
  these functions directly.
*/

// Exact semver: MAJOR.MINOR.PATCH with optional prerelease/build. No ranges,
// no wildcards, no partial versions, no dist-tags.
const SEMVER = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?`

// npm:/jsr: package specifier: optional @scope/, name, @exact, optional /subpath.
const REGISTRY_PINNED = new RegExp(
  String.raw`^(?:npm|jsr):(?:@[^/@\s]+/)?[^/@\s]+@${SEMVER}(?:/[^\s]*)?$`,
)

// https URL: some path segment must carry @exact (optionally v-prefixed, as
// deno.land/x uses), ending at a path, query, fragment or end of string.
const URL_PINNED = new RegExp(String.raw`@v?${SEMVER}(?:[/?#]|$)`)

export function isRemote(specifier) {
  return /^(?:npm:|jsr:|https?:\/\/)/i.test(specifier)
}

/** Returns null when pinned (or not remote), else a human reason. */
export function pinViolation(specifier) {
  if (!isRemote(specifier)) return null
  if (/^http:\/\//i.test(specifier)) return 'insecure http:// import; use https:// with an exact version'
  if (/^https:\/\//i.test(specifier)) {
    // Only look at the path, so a host such as `esm.sh` is never mistaken for a version.
    const path = specifier.replace(/^https:\/\/[^/]+/i, '')
    return URL_PINNED.test(path) ? null : 'URL import without an exact @MAJOR.MINOR.PATCH version'
  }
  return REGISTRY_PINNED.test(specifier)
    ? null
    : 'registry import without an exact MAJOR.MINOR.PATCH version (ranges, majors and tags float)'
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length

// Each pattern captures the specifier in group 2 (group 1 is the quote).
const STATIC_PATTERNS = [
  // import x from "s" / export * from "s" / import type { X } from "s"
  /\bfrom\s*(['"])([^'"\n]+)\1/g,
  // side-effect import: import "s"
  /(?:^|[^.\w$])import\s*(['"])([^'"\n]+)\1/g,
  // dynamic import with a literal: import("s") / import(`s`)
  /(?:^|[^.\w$])import\s*\(\s*(['"`])([^'"`\n]+)\1\s*[,)]/g,
  // /// <reference types="s" /> and // @deno-types="s"
  /<reference\s+(?:types|path)\s*=\s*(['"])([^'"\n]+)\1/g,
  /@deno-types\s*=\s*(['"])([^'"\n]+)\1/g,
]

/**
 * Scan one source file's text. Returns violations as
 * { line, specifier, reason }. A dynamic import whose argument is not a plain
 * string literal is reported too: it cannot be verified, so it fails closed.
 */
export function scanSource(text) {
  const out = []
  const seen = new Set()
  for (const pattern of STATIC_PATTERNS) {
    pattern.lastIndex = 0
    for (const m of text.matchAll(pattern)) {
      const specifier = m[2]
      const index = m.index + m[0].indexOf(specifier)
      const key = `${index}:${specifier}`
      if (seen.has(key)) continue
      seen.add(key)
      if (pattern === STATIC_PATTERNS[2] && m[1] === '`' && specifier.includes('${')) continue
      const reason = pinViolation(specifier)
      if (reason) out.push({ line: lineOf(text, index), specifier, reason })
    }
  }
  for (const m of text.matchAll(/(?:^|[^.\w$])import\s*\(\s*(?!['"`][^'"`\n${]*['"`]\s*[,)])([^)\n]{0,80})/g)) {
    const arg = m[1].trim()
    // Only flag when the argument is computed; relative literals were handled above.
    if (arg === '') continue
    out.push({
      line: lineOf(text, m.index),
      specifier: `import(${arg}`,
      reason: 'dynamic import with a computed specifier cannot be verified as pinned',
    })
  }
  return out.sort((a, b) => a.line - b.line)
}

/**
 * Scan a Deno import map / deno.json text: every remote value under
 * "imports" and "scopes" must be pinned. Returns { key, specifier, reason }.
 */
export function scanImportMap(jsonText) {
  const parsed = JSON.parse(jsonText)
  const out = []
  const check = (map, prefix) => {
    for (const [key, value] of Object.entries(map ?? {})) {
      if (typeof value !== 'string') continue
      // A trailing-slash prefix mapping ("npm:pkg@1.2.3/") is checked without the slash.
      const reason = pinViolation(value.endsWith('/') ? value.slice(0, -1) : value)
      if (reason) out.push({ key: `${prefix}${key}`, specifier: value, reason })
    }
  }
  check(parsed.imports, 'imports.')
  for (const [scope, map] of Object.entries(parsed.scopes ?? {})) check(map, `scopes.${scope}.`)
  return out
}
