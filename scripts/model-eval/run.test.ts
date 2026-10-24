// RV-MM1 AC6, AC7, AC11-AC16: the eval end to end, offline. Global fetch throws; the
// transport is a fake OpenAI answering from the fixtures; the renderer is a fake.
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_MARKER, completion, fakeOpenAi, fakeRenderer, perfectContent } from './fake-openai.testkit';
import { loadFixtures } from './fixtures';
import { RendererUnavailable } from './render';
import { isInside, REPO_ROOT } from './report';
import { runEval, type RunPorts } from './run';

// Whole runs, retries with the handler's own backoff included.
vi.setConfig({ testTimeout: 60_000 });

const SENTINEL = 'sk-SENTINEL-not-a-real-key-7c4e2b';
const fixtures = loadFixtures();
let scratch: string;

beforeEach(() => {
  vi.stubGlobal('fetch', () => { throw new Error('offline test: global fetch must not be called'); });
  scratch = mkdtempSync(join(tmpdir(), 'rv-mm1-model-eval-test-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(scratch, { recursive: true, force: true });
});

function harness(env: Record<string, string>, options: { transport?: RunPorts['transport']; renderer?: RunPorts['renderer'] } = {}) {
  const printed: string[] = [];
  const fake = fakeOpenAi(fixtures);
  const transport = vi.fn(options.transport ?? fake.transport);
  const renderer = options.renderer ?? fakeRenderer();
  const run = () => runEval({ env, transport, renderer, print: line => { printed.push(line); }, progress: () => {}, tmpdir: scratch });
  return { run, printed, transport, renderer, calls: fake.calls };
}

/** Every file a run wrote, as text. */
const written = (dir: string): string[] => readdirSync(dir).map(name => readFileSync(join(dir, name), 'latin1'));

describe('refusals (AC7): no request, a failed run, one line', () => {
  it.each([
    ['CI is set', { CI: 'true', AMANI_EVAL_OPENAI_API_KEY: SENTINEL }, /^model eval refused: CI is set/],
    ['no eval key and no dry run', { OPENAI_API_KEY: SENTINEL }, /^model eval refused: AMANI_EVAL_OPENAI_API_KEY/],
    ['a malformed candidate', { AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_CANDIDATES: 'ocr=gpt-4o@low' }, /^model eval refused: .*reasoning model/],
  ])('%s', async (_label, env, reason) => {
    const h = harness(env);
    const result = await h.run();
    expect(result).toMatchObject({ ok: false, outDir: null });
    expect(result.reason).toMatch(reason);
    expect(result.reason!.split('\n')).toHaveLength(1);
    expect(h.printed).toEqual([result.reason]);
    expect(h.transport).not.toHaveBeenCalled();
    expect(readdirSync(scratch)).toEqual([]);
    expect(h.printed.join('\n')).not.toContain(SENTINEL);
  });

  it('refuses an output directory inside the repository, and creates nothing there', async () => {
    const inside = join(REPO_ROOT, 'scripts', 'model-eval', 'not-created-by-the-eval');
    for (const dir of [REPO_ROOT, join(REPO_ROOT, 'scripts'), inside]) {
      const h = harness({ AMANI_EVAL_DRY_RUN: '1', AMANI_EVAL_OUT_DIR: dir });
      const result = await h.run();
      expect(result).toMatchObject({ ok: false });
      expect(result.reason).toMatch(/output directory is inside the repository/);
    }
    expect(existsSync(inside)).toBe(false);
  });

  it('refuses a plan over the call cap before any request (AC11)', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_MAX_CALLS: '10' });
    const result = await h.run();
    expect(result.reason).toBe('model eval refused: 144 calls planned, over AMANI_EVAL_MAX_CALLS=10; lower AMANI_EVAL_REPEATS or name fewer candidates');
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.printed[0]).toMatch(/144 calls planned \(cap 10\); worst-case estimate \$\d+\.\d\d at list prices$/);
  });
});

describe('dry run (AC15): no key, no network; every request built, checked and written', () => {
  it('builds every request for the default targets, writes them with images elided, and sends nothing', async () => {
    const h = harness({ AMANI_EVAL_DRY_RUN: '1' });
    const result = await h.run();
    expect(result).toMatchObject({ ok: true, reason: null });
    expect(h.transport).not.toHaveBeenCalled();
    expect(h.printed[0]).toMatch(/^model eval: dry run \(no key, nothing sent\); 8 targets x 3 repeats; 144 calls planned \(cap 200\)/);
    expect(h.printed.at(-1)).toMatch(/^dry run: 40 requests built and checked; nothing was sent\. Requests: /);
    const report = JSON.parse(readFileSync(join(result.outDir!, 'report.json'), 'utf8')) as { requests: Array<Record<string, unknown>> };
    expect(report.requests).toHaveLength(40);
    const raw = readFileSync(join(result.outDir!, 'report.json'), 'utf8');
    expect(raw).not.toContain('data:image/');
    expect(raw).toContain('<image elided: image/png');
    expect(readdirSync(result.outDir!).filter(name => /\.(png|jpg)$/.test(name))).toHaveLength(11);
    // The output dir is new, under the given temp dir (by real path: Windows may give a short 8.3 one).
    expect(isInside(result.outDir!, realpathSync.native(scratch))).toBe(true);
    expect(isInside(result.outDir!, REPO_ROOT)).toBe(false);
    for (const request of report.requests) {
      expect(request.body).toMatchObject({ store: false, response_format: { type: 'json_object' } });
      if (request.role === 'candidate') expect(request.body).not.toHaveProperty('temperature');
    }
  });

  it('without a browser, OCR is SKIPPED with the install command and the other uses still build', async () => {
    const renderer = { render: async () => { throw new RendererUnavailable('no Chromium to render the OCR pages (Error); run: npx playwright install chromium'); }, close: async () => {} };
    const h = harness({ AMANI_EVAL_DRY_RUN: '1' }, { renderer });
    const result = await h.run();
    expect(result.ok).toBe(true);
    expect(h.printed.join('\n')).toContain('OCR SKIPPED: no Chromium to render the OCR pages (Error); run: npx playwright install chromium');
    expect(h.printed[0]).toContain('84 calls planned');
    expect(h.printed.at(-1)).toMatch(/^dry run: 20 requests built/);
  });
});

describe('a real run against a fake OpenAI (AC9-AC14)', () => {
  it('perfect answers: every target ELIGIBLE; the key reaches only the Authorization header', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1' });
    const result = await h.run();
    expect(result.reason).toBeNull();
    expect(result.verdicts.map(v => [v.target.use, v.target.role, v.verdict])).toEqual([
      ['ocr', 'baseline', 'ELIGIBLE'], ['ocr', 'candidate', 'ELIGIBLE'],
      ['extraction', 'baseline', 'ELIGIBLE'], ['extraction', 'candidate', 'ELIGIBLE'],
      ['interpretation', 'baseline', 'ELIGIBLE'], ['interpretation', 'candidate', 'ELIGIBLE'],
      ['labInsights', 'baseline', 'ELIGIBLE'], ['labInsights', 'candidate', 'ELIGIBLE'],
    ]);
    // One call at a time, every one to the endpoint, with the key in its header only.
    expect(h.calls).toHaveLength(40);
    for (const call of h.calls) {
      expect(call.url).toBe('https://api.openai.com/v1/chat/completions');
      expect(call.authorization).toBe(`Bearer ${SENTINEL}`);
      expect(JSON.stringify(call.body)).not.toContain(SENTINEL);
    }
    const extraction = result.verdicts.find(v => v.target.use === 'extraction' && v.target.role === 'candidate')!;
    expect(extraction.metrics.quality).toBe('rows 32/32 value 32/32 text 32/32 unit 32/32 range 25/25 extra 0 fabricated 0');
    const ocr = result.verdicts.find(v => v.target.use === 'ocr' && v.target.role === 'baseline')!;
    expect(ocr.metrics.quality).toBe(
      'rows 94/94 value 94/94 text 94/94 unit 94/94 range 72/72 extra 0 fabricated 0 snippet 94/94 metadata 10/10 inferred 0');
    const interp = result.verdicts.find(v => v.target.use === 'interpretation' && v.target.role === 'candidate')!;
    expect(interp.metrics).toMatchObject({ cap: 6200, reasoningMax: 256 });
    expect(interp.metrics.quality).toBe('ai 4/4 schema-fail 0 policy-fail1 0 retried 0 sanitize-null 0 floor 0 served-policy 0');
    // stdout: the plan, one table, the results path; no model text and no key anywhere.
    const stdout = h.printed.join('\n');
    expect(stdout).not.toContain(ANSWER_MARKER);
    expect(stdout).not.toContain(SENTINEL);
    expect(h.printed.filter(line => line.startsWith('use '))).toHaveLength(1);
    for (const file of written(result.outDir!)) expect(file).not.toContain(SENTINEL);
    expect(readFileSync(join(result.outDir!, 'report.json'), 'utf8')).toContain(ANSWER_MARKER);
  });

  it('a truncated candidate is BLOCKING and fails the run; the baseline stays ELIGIBLE', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1', AMANI_EVAL_CANDIDATES: 'extraction=gpt-6-luna' }, {
      transport: fakeOpenAi(fixtures, body => (body.model === 'gpt-6-luna'
        ? completion('gpt-6-luna', perfectContent(fixtures, body), { finish_reason: 'length' }) : null)).transport,
    });
    const result = await h.run();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('model eval failed: extraction gpt-6-luna BLOCKING');
    expect(result.verdicts.map(v => v.verdict)).toEqual(['ELIGIBLE', 'BLOCKING']);
    expect(h.printed).toContain('BLOCKING extraction candidate gpt-6-luna: finish_length x4');
  });

  it('a candidate whose interpretations all fall back is flagged, not BLOCKING, and its floor holds', async () => {
    const violating = { headline: 'h', primary_concern: { title: 't', summary: 's', why_it_matters: 'w' }, key_findings: [], pattern_signals: [],
      what_you_can_do_now: [], what_to_do_next: [], overall_interpretation: 'Take 5000 IU of vitamin D daily.', questions_for_doctor: [],
      cycle_context: {}, disclaimer: 'Educational use only.' };
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1', AMANI_EVAL_CANDIDATES: 'interpretation=gpt-6-luna@low' }, {
      transport: fakeOpenAi(fixtures, body => (body.model === 'gpt-6-luna' ? completion('gpt-6-luna', violating) : null)).transport,
    });
    const result = await h.run();
    expect(result.reason).toBeNull();
    const candidate = result.verdicts[1]!;
    expect(candidate).toMatchObject({ verdict: 'ELIGIBLE', target: { effort: 'low' } });
    expect(candidate.metrics.quality).toBe('ai 0/4 schema-fail 0 policy-fail1 4 retried 4 sanitize-null 4 floor 0 served-policy 0');
    const sent = h.transport.mock.calls.map(([, init]) => JSON.parse(String(init.body)) as Record<string, unknown>)
      .filter(body => body.model === 'gpt-6-luna');
    expect(sent).toHaveLength(8);
    for (const body of sent) expect(body).toMatchObject({ reasoning_effort: 'low', max_completion_tokens: 6200, store: false });
  });

  it('calls that never get past 5xx leave the target INCOMPLETE and fail the run', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1', AMANI_EVAL_CANDIDATES: 'labInsights=gpt-5.6-terra' }, {
      transport: fakeOpenAi(fixtures, body => (body.model === 'gpt-5.6-terra' ? new Response('upstream', { status: 503 }) : null)).transport,
    });
    const result = await h.run();
    expect(result.reason).toBe('model eval failed: labInsights gpt-5.6-terra INCOMPLETE');
    expect(result.verdicts[1]).toMatchObject({ verdict: 'INCOMPLETE', unanswered: 2, metrics: { calls: 2, retries: 4 } });
  });

  it('stops at the request cap, retries included, and fails the run (AC11, AC14)', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1', AMANI_EVAL_CANDIDATES: 'labInsights=gpt-5.6-terra', AMANI_EVAL_MAX_CALLS: '4' }, {
      transport: fakeOpenAi(fixtures, (_body, _use, n) => (n === 1 ? new Response('busy', { status: 500 }) : null)).transport,
    });
    const result = await h.run();
    expect(result.reason).toBe('model eval failed: guard: request cap of 4 reached');
    expect(h.transport).toHaveBeenCalledTimes(4);
  });

  it('the baseline being unavailable is said, not hidden', async () => {
    const h = harness({ AMANI_EVAL_OPENAI_API_KEY: SENTINEL, AMANI_EVAL_REPEATS: '1', AMANI_EVAL_CANDIDATES: 'labInsights=gpt-5.6-terra' }, {
      transport: fakeOpenAi(fixtures, body => (body.model === 'gpt-5-mini' ? new Response('{"error":{"message":"model shut down"}}', { status: 404 }) : null)).transport,
    });
    const result = await h.run();
    expect(result.verdicts.map(v => v.verdict)).toEqual(['BLOCKING', 'ELIGIBLE']);
    expect(h.printed).toContain('note labInsights candidate gpt-5.6-terra: baseline unavailable (it gave no answer), so these metrics stand alone');
  });
});

describe('it never runs in CI and never shells out (AC6, AC7, AC16)', () => {
  const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
  const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });

  it('nothing under .github mentions the eval or its variables', () => {
    for (const file of filesUnder(repo('.github'))) {
      const content = readFileSync(file, 'utf8');
      expect(content, file).not.toContain('model-eval');
      expect(content, file).not.toContain('AMANI_EVAL_');
    }
  });

  it('no npm script runs it, and the CI Vitest config cannot pick up *.eval.ts', () => {
    const scripts = (JSON.parse(readFileSync(repo('package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    for (const command of Object.values(scripts)) expect(command).not.toMatch(/model-eval|vitest\.eval/);
    const ciConfig = readFileSync(repo('vitest.config.ts'), 'utf8');
    expect(ciConfig).not.toContain('.eval.ts');
    expect(readFileSync(new URL('./vitest.eval.config.ts', import.meta.url), 'utf8'))
      .toContain("include: ['scripts/model-eval/**/*.eval.ts'],");
  });

  it('no module of the eval spawns a process, reads a URL path as a file path, or builds a Supabase client', () => {
    const banned = [new RegExp(['child', 'process'].join('_')), new RegExp(String.raw`\.path` + 'name\\b'),
      new RegExp(['exec', 'Sync'].join('')), new RegExp(String.raw`\bspawn` + String.raw`\(`), new RegExp(['create', 'Client'].join(''))];
    const dir = fileURLToPath(new URL('./', import.meta.url));
    for (const name of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const source = readFileSync(join(dir, name), 'utf8');
      for (const pattern of banned) expect(source, `${name} ${pattern}`).not.toMatch(pattern);
    }
  });
});
