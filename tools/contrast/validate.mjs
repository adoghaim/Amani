/*
  Fails if any theme token that is used as TEXT falls below WCAG AA (4.5:1)
  against the surface it actually renders on.

  This exists because the palette has been wrong twice in ways review missed:
  neutral-400 carried 78 text usages at 2.63:1, and the categorical hues were
  documented as "chips with a separate label" when the colour IS the label.
  Eyeballing a palette does not catch either. A script does.

  Ground selection is deliberate rather than clever: a `flag-x` / `phase-x`
  token is checked against its own `-bg` tint, because that is where it is
  rendered. Everything else is checked against BOTH the page ground and the
  card surface, and must clear on both — the stricter of the two wins.

  Run: node tools/contrast/validate.mjs
*/
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import config from '../../tailwind.config.js'

const T = config.theme.extend.colors.theme
const AA = 4.5

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
}
const contrast = (a, b) => {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|jsx?)$/.test(p)) out.push(p)
  }
  return out
}

const source = walk('src').map((p) => readFileSync(p, 'utf8')).join('\n')

// Which tokens are actually used to paint text (or SVG glyph fills)?
const usedAsText = new Set()
for (const m of source.matchAll(/(?:^|[\s"'`:])(?:text|placeholder:text|fill|stroke)-theme-([a-z0-9-]+)/g)) {
  if (T[m[1]] !== undefined) usedAsText.add(m[1])
}

/*
  Tokens that paint decorative graphics only — never a glyph of text. WCAG's
  4.5:1 text rule does not apply; the 3:1 non-text rule does. Each entry must
  name where it is used, and the validator still enforces the 3:1 floor so an
  entry here cannot hide an invisible icon.
*/
const DECORATIVE = {
  'primary-faded': 'empty-state illustration icons (Reports Search, Dashboard TestTube2)',
}
const GRAPHIC_MIN = 3.0

const failures = []
const checked = []
for (const token of [...usedAsText].sort()) {
  const fg = T[token]
  if (typeof fg !== 'string' || !fg.startsWith('#')) continue

  const own = T[`${token}-bg`]
  const grounds = own ? [[`${token}-bg`, own]] : [['background', T.background], ['surface', T.surface]]

  for (const [name, bg] of grounds) {
    const ratio = contrast(fg, bg)
    const decorative = DECORATIVE[token] !== undefined
    const floor = decorative ? GRAPHIC_MIN : AA
    checked.push({ token, fg, on: name, ratio, decorative, floor })
    if (ratio < floor) failures.push({ token, fg, on: name, bg, ratio, floor })
  }
}

const width = Math.max(...checked.map((c) => c.token.length))
for (const c of checked) {
  const ok = c.ratio >= c.floor
  const tag = c.decorative ? '  (graphic, 3:1)' : ''
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.token.padEnd(width)} ${c.fg}  on ${c.on.padEnd(18)} ${c.ratio.toFixed(2)}:1${tag}`)
}

console.log(`\n${checked.length} checks across ${usedAsText.size} text tokens`)
if (failures.length) {
  console.error(`\n${failures.length} token(s) below their contrast floor:`)
  for (const f of failures) console.error(`  ${f.token} ${f.fg} on ${f.on} ${f.bg} = ${f.ratio.toFixed(2)}:1 (needs ${f.floor}:1)`)
  process.exit(1)
}
console.log('All text tokens clear WCAG AA against the surface they render on.')
