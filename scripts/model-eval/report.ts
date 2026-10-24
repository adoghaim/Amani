/**
 * Where the model eval's output goes (RV-MM1 AC13). stdout gets one summary
 * table and no model text; the full record (synthetic answers, request bodies
 * with images elided) goes to report.json in a new directory under
 * AMANI_EVAL_OUT_DIR or the OS temp dir, never inside the repository. Nothing
 * here receives the key: requests are recorded without their headers.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export function isInside(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The real path of `path`, resolving the part that exists (so a link cannot hide the repository). */
function realPath(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  return join(existsSync(current) ? realpathSync.native(current) : current, ...missing);
}

export type OutDir = { ok: true; dir: string } | { ok: false; reason: string };

/** A new, empty directory for this run's files: under `requested`, or the OS temp dir. */
export function resolveOutDir(requested: string | null, tmpdir: string, repoRoot: string = REPO_ROOT): OutDir {
  const base = realPath(requested ?? tmpdir);
  if (isInside(base, realPath(repoRoot))) {
    return { ok: false, reason: 'model eval refused: the output directory is inside the repository; set AMANI_EVAL_OUT_DIR outside it' };
  }
  mkdirSync(base, { recursive: true });
  return { ok: true, dir: mkdtempSync(join(base, 'amani-model-eval-')) };
}

/** A copy of `value` with every image data URL replaced by its type, size and hash. */
export function elideImages(value: unknown): unknown {
  if (typeof value === 'string') {
    const m = /^data:(image\/[a-z]+);base64,/.exec(value);
    if (!m) return value;
    const sha = createHash('sha256').update(value).digest('hex').slice(0, 16);
    return `<image elided: ${m[1]}, ${value.length} chars, sha256 ${sha}>`;
  }
  if (Array.isArray(value)) return value.map(elideImages);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, elideImages(inner)]));
  }
  return value;
}

export interface WrittenImage {
  name: string;
  dataUrl: string;
}

/** Writes report.json (images elided) and each rendered page; returns the report path. */
export function writeReport(dir: string, report: unknown, images: readonly WrittenImage[] = []): string {
  const path = join(dir, 'report.json');
  writeFileSync(path, `${JSON.stringify(elideImages(report), null, 2)}\n`, 'utf8');
  for (const image of images) {
    const comma = image.dataUrl.indexOf(',');
    writeFileSync(join(dir, image.name), Buffer.from(image.dataUrl.slice(comma + 1), 'base64'));
  }
  return path;
}

/** A fixed-width text table. */
export function table(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((cell, i) => Math.max(cell.length, ...rows.map(row => (row[i] ?? '').length)));
  const line = (row: readonly string[]) => row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd();
  return [line(header), line(widths.map(w => '-'.repeat(w))), ...rows.map(line)];
}
