/*
  Fails (exit 1) on any unpinned remote import under supabase/functions
  (PK-SUPPLY-01). Rules live in pinned-imports.mjs; this file only walks the
  tree and prints.

  Scanned: every .ts/.tsx/.js/.jsx/.mjs/.mts file, plus any deno.json,
  deno.jsonc or import_map.json (an import map is how a bare specifier reaches
  a remote package, so its values must be pinned as well). A map that cannot
  be parsed fails closed.

  Run: node tools/supply-chain/check-pinned-imports.mjs [root]
*/
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanImportMap, scanSource } from './pinned-imports.mjs'

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const root = process.argv[2] ?? join(repo, 'supabase', 'functions')

const show = (p) => (p.startsWith(repo) ? relative(repo, p) || p : p)

const SOURCE = /\.(?:tsx?|jsx?|mjs|mts)$/
const IMPORT_MAP = /^(?:deno\.jsonc?|import_map\.json)$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const files = walk(root)
const problems = []
let sources = 0
let maps = 0
for (const file of files) {
  const rel = show(file)
  const base = file.split(/[\\/]/).pop()
  if (IMPORT_MAP.test(base)) {
    maps += 1
    try {
      const text = readFileSync(file, 'utf8')
      // deno.jsonc allows comments; strip whole-line ones before parsing.
      const json = base.endsWith('.jsonc') ? text.replace(/^\s*\/\/.*$/gm, '') : text
      for (const v of scanImportMap(json)) problems.push(`${rel} ${v.key}: ${v.specifier} — ${v.reason}`)
    } catch (err) {
      problems.push(`${rel}: cannot parse import map (${err.message}); refusing to pass unverified`)
    }
  } else if (SOURCE.test(base)) {
    sources += 1
    for (const v of scanSource(readFileSync(file, 'utf8'))) {
      problems.push(`${rel}:${v.line}: ${v.specifier} — ${v.reason}`)
    }
  }
}

if (sources === 0) {
  console.error(`No source files found under ${show(root)}; refusing an empty check.`)
  process.exit(1)
}

if (problems.length > 0) {
  console.error(`Unpinned remote imports under ${show(root)} (${problems.length}):`)
  for (const p of problems) console.error(`  ${p}`)
  console.error('Pin each to an exact MAJOR.MINOR.PATCH version, e.g. npm:zod@3.25.76.')
  process.exit(1)
}
console.log(`Pinned imports: ${sources} source files and ${maps} import maps scanned; 0 unpinned remote imports.`)
