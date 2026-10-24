#!/usr/bin/env node
// Compare the nutrient policy's verdicts at two revisions over every string in
// the repository, so a change to supabase/functions/_shared/nutrient-policy.ts
// shows exactly which repo sentences it newly flags or stops flagging.
//
//   node tools/nutrient-policy/repo-scan.mjs --base <git-ref> [--head <git-ref>]
//
// --head defaults to the module in the working tree. The corpus is the working
// tree's tracked files: string literals, template text and JSX text in
// TypeScript/JavaScript, string values in JSON, string literals in SQL, every
// line and sentence of Markdown, text and HTML files (table cells split out),
// and every line of any other text file. Each distinct string is checked once
// with findTextViolations at both revisions.
//
// Prints each string whose result differs, with its first location. Exits 1
// when a violation the base reported is missing or reworded at head: the
// guardrail may only get stricter.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import ts from 'typescript';

const MODULE = 'supabase/functions/_shared/nutrient-policy.ts';
const CODE = /\.(?:[cm]?[jt]sx?)$/;
const PROSE = /\.(?:md|txt|html)$/;
const BINARY = /\.(?:png|jpe?g|gif|ico|pdf|jar|keystore|jks|aab|apk|ipa|woff2?|ttf|otf|zip|gz)$/i;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

async function loadPolicy(ref) {
  const source = ref ? git('show', `${ref}:${MODULE}`) : readFileSync(MODULE, 'utf8');
  const { code } = transformSync(source, { loader: 'ts', format: 'esm', target: 'es2022' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function codeStrings(path, text, add) {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const at = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text, at(node));
    else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
      for (const part of parts) add(part, at(node));
      add(parts.join('…'), at(node));
    } else if (ts.isJsxText(node)) add(node.text.replace(/\s+/g, ' '), at(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
}

function jsonStrings(text, add) {
  const walk = (v) => {
    if (typeof v === 'string') add(v, 0);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { add(k, 0); walk(x); });
  };
  walk(JSON.parse(text));
}

function sqlStrings(text, add) {
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/'((?:[^']|'')*)'/g)) add(m[1].replace(/''/g, "'"), i + 1);
  });
}

function proseStrings(text, add) {
  text.split('\n').forEach((line, i) => {
    const cells = line.includes('|') ? line.split('|') : [line];
    for (const cell of cells) {
      const clean = cell.replace(/^\s*(?:#+|>|[-*+]|\d+[.)])\s+/, '').trim();
      add(clean, i + 1);
      for (const sentence of clean.split(/(?<=[.!?])\s+/)) add(sentence, i + 1);
    }
  });
}

function lineStrings(text, add) {
  text.split('\n').forEach((line, i) => add(line.trim(), i + 1));
}

function collectCorpus() {
  const corpus = new Map();
  let files = 0;
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) {
    if (BINARY.test(path)) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // listed but absent from the working tree
    }
    if (text.includes('\0')) continue;
    files += 1;
    const add = (s, line) => {
      const value = s.trim();
      if (value && !corpus.has(value)) corpus.set(value, `${path}:${line}`);
    };
    if (CODE.test(path)) codeStrings(path, text, add);
    else if (path.endsWith('.json')) {
      try { jsonStrings(text, add); } catch { lineStrings(text, add); }
    } else if (path.endsWith('.sql')) { sqlStrings(text, add); lineStrings(text, add); }
    else if (PROSE.test(path)) proseStrings(text, add);
    else lineStrings(text, add);
  }
  return { corpus, files };
}

const baseRef = arg('--base');
const headRef = arg('--head');
if (!baseRef) {
  console.error('usage: node tools/nutrient-policy/repo-scan.mjs --base <git-ref> [--head <git-ref>]');
  process.exit(2);
}

const base = await loadPolicy(baseRef);
const head = await loadPolicy(headRef);
const { corpus, files } = collectCorpus();

let gained = 0;
let lost = 0;
let flaggedBase = 0;
let flaggedHead = 0;
const lines = [];
for (const [text, where] of corpus) {
  const a = base.findTextViolations(text);
  const b = head.findTextViolations(text);
  if (a.length > 0) flaggedBase += 1;
  if (b.length > 0) flaggedHead += 1;
  if (JSON.stringify(a) === JSON.stringify(b)) continue;
  const dropped = a.filter((v) => !b.includes(v));
  if (dropped.length > 0) lost += 1;
  else gained += 1;
  lines.push(`${dropped.length > 0 ? 'LOST  ' : 'GAINED'} ${where}\n  ${JSON.stringify(text)}\n  base=${JSON.stringify(a)}\n  head=${JSON.stringify(b)}`);
}

const headLabel = headRef ?? 'working tree';
console.log(`nutrient-policy repo scan: base ${baseRef} (${git('rev-parse', '--short', baseRef).trim()}), head ${headLabel}`);
console.log(`files scanned: ${files}; distinct strings: ${corpus.size}; flagged at base ${flaggedBase}, at head ${flaggedHead}`);
console.log(`differing: ${lines.length} (gained ${gained}, lost ${lost})`);
for (const line of lines) console.log(line);
process.exit(lost > 0 ? 1 : 0);
