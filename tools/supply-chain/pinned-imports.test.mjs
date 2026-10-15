// PK-SUPPLY-01: every remote import under supabase/functions names one exact
// version. Run: node --test tools/supply-chain/pinned-imports.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRemote, pinViolation, scanImportMap, scanSource } from './pinned-imports.mjs'

const CLI = fileURLToPath(new URL('./check-pinned-imports.mjs', import.meta.url))
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

test('exact versions are pinned', () => {
  for (const s of [
    'npm:zod@3.25.76',
    'npm:@supabase/supabase-js@2.105.3',
    'npm:stripe@17.7.0',
    'npm:pkg@1.2.3-beta.1+build.5',
    'npm:@scope/pkg@1.2.3/sub/path.js',
    'jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts',
    'jsr:@std/assert@1.0.13',
    'https://deno.land/std@0.224.0/http/server.ts',
    'https://deno.land/x/foo@v1.2.3/mod.ts',
    'https://esm.sh/zod@3.25.76?target=deno',
    'https://esm.sh/@supabase/supabase-js@2.105.3',
  ]) assert.equal(pinViolation(s), null, s)
})

test('ranges, majors, tags and missing versions are unpinned', () => {
  for (const s of [
    'npm:@supabase/supabase-js@2',
    'npm:@supabase/supabase-js@2.49',
    'npm:zod@^3.25.76',
    'npm:zod@~3.25.76',
    'npm:zod@>=3.0.0',
    'npm:zod@latest',
    'npm:zod@3.x',
    'npm:zod@*',
    'npm:zod',
    'npm:@scope/pkg',
    'npm:@scope/pkg/sub',
    'jsr:@supabase/functions-js/edge-runtime.d.ts',
    'jsr:@std/assert@1',
    'jsr:@std/assert@^1.0.0',
    'https://esm.sh/zod',
    'https://esm.sh/zod@3',
    'https://deno.land/std/http/server.ts',
    'https://deno.land/x/foo@v1/mod.ts',
    'https://cdn.example.com/1.2.3/lib.js',
    'http://deno.land/std@0.224.0/http/server.ts',
  ]) assert.ok(pinViolation(s), s)
})

test('local, built-in and bare specifiers are not remote', () => {
  for (const s of ['./x.ts', '../_shared/y.ts', '/abs.ts', 'node:fs', 'vitest', 'react']) {
    assert.equal(isRemote(s), false, s)
    assert.equal(pinViolation(s), null, s)
  }
})

test('scanSource finds every import form and reports line numbers', () => {
  const src = [
    'import "jsr:@supabase/functions-js/edge-runtime.d.ts";', // 1 side effect
    "import { createClient } from 'npm:@supabase/supabase-js@2';", // 2 from
    'import {', // 3 multi-line
    '  z,', // 4
    '} from "npm:zod@^3.25.76";', // 5
    'export * from "https://esm.sh/zod";', // 6 re-export
    'const m = await import("npm:stripe@17");', // 7 dynamic literal
    '/// <reference types="npm:@types/node" />', // 8 reference
    '// @deno-types="npm:@types/foo@1"', // 9 deno-types
    'const n = await import(name);', // 10 computed dynamic
    'import type { T } from "npm:pkg@1.0";', // 11 type import
  ].join('\n')
  const found = scanSource(src)
  assert.deepEqual(found.map((v) => v.line), [1, 2, 5, 6, 7, 8, 9, 10, 11])
  assert.match(found.find((v) => v.line === 10).reason, /computed specifier/)
})

test('scanSource passes pinned imports and ignores look-alikes that are not imports', () => {
  const src = [
    'import "jsr:@supabase/functions-js@2.105.3/edge-runtime.d.ts";',
    "import { createClient } from 'npm:@supabase/supabase-js@2.105.3';",
    'import { z } from "npm:zod@3.25.76";',
    'import { helper } from "../_shared/helper.ts";',
    'import { readFileSync } from "node:fs";',
    'const m = await import("./local.ts");',
    'await supabase.from("lab_reports").select("*");',
    'const url = "https://api.openai.com/v1/chat/completions";',
    'await fetch("https://api.stripe.com/v1/customers");',
    'const text = `You can import data from "your clinician"`;',
  ].join('\n')
  assert.deepEqual(scanSource(src), [])
})

test('scanImportMap checks imports and scopes, allowing pinned prefix maps', () => {
  const ok = JSON.stringify({
    imports: { zod: 'npm:zod@3.25.76', 'std/': 'https://deno.land/std@0.224.0/', local: './x.ts' },
    scopes: { './a/': { b: 'jsr:@std/assert@1.0.13' } },
  })
  assert.deepEqual(scanImportMap(ok), [])
  const bad = JSON.stringify({
    imports: { zod: 'npm:zod@^3.25.76', 'std/': 'https://deno.land/std/' },
    scopes: { './a/': { b: 'jsr:@std/assert@1' } },
  })
  assert.deepEqual(scanImportMap(bad).map((v) => v.key), ['imports.zod', 'imports.std/', 'scopes../a/.b'])
})

test('the real supabase/functions tree has no unpinned remote imports', () => {
  const r = run()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /0 unpinned remote imports/)
})

test('the CLI fails on an unpinned import and on an unparseable import map', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinned-imports-'))
  try {
    mkdirSync(join(dir, 'fn'))
    writeFileSync(join(dir, 'fn', 'index.ts'), 'import { z } from "npm:zod@3.25.76";\n')
    assert.equal(run(dir).status, 0)

    writeFileSync(join(dir, 'fn', 'other.ts'), 'import { createClient } from "npm:@supabase/supabase-js@2";\n')
    let r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /other\.ts:1: npm:@supabase\/supabase-js@2/)

    rmSync(join(dir, 'fn', 'other.ts'))
    writeFileSync(join(dir, 'deno.json'), '{ not json')
    r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /cannot parse import map/)

    writeFileSync(join(dir, 'deno.json'), JSON.stringify({ imports: { zod: 'npm:zod@3' } }))
    r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /imports\.zod: npm:zod@3/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the CLI refuses an empty tree rather than passing vacuously', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pinned-imports-empty-'))
  try {
    const r = run(dir)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /refusing an empty check/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
