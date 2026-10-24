/**
 * The synthetic model eval (RV-MM1 AC6-AC16): owner-run through
 * golden-set.eval.ts, with README.md as the runbook. One call at a time, each
 * through the guard, each request built by the handlers' own code
 * (handlers.ts). Every request is first built against a transport that sends
 * nothing, checked against its target, and counted and priced, so the call cap
 * and the worst-case cost are known before the first real call. A dry run
 * (AMANI_EVAL_DRY_RUN=1) stops there and writes the requests out. A real run
 * then sends them, checks every answer (checks.ts) and gives one verdict per
 * (use, model[, effort]). Any BLOCKING verdict, unanswered call, guard
 * violation or refusal fails the run.
 */
import { estimateCostUsd } from '../../supabase/functions/_shared/ai-cost-ledger';
import type { GenerationSample } from '../../supabase/functions/_shared/generation-cost';
import { ocrImagesRefusal } from '../../supabase/functions/_shared/lab-extraction';
import { isReasoningModel } from '../../supabase/functions/_shared/openai-models';
import {
  callRecord, checkInsights, checkInterpretation, checkRows, verdictFor,
  type CallRecord, type CaseCheck, type TargetVerdict,
} from './checks';
import { readEvalConfig, targetEnv, targetLabel, type EvalConfig, type EvalTarget } from './env';
import {
  insightsInput, loadFixtures, ocrExpectedRows, pageText,
  type ExpectedRow, type Fixtures, type InsightsPair, type InterpretationPanel, type LabText, type OcrCase,
} from './fixtures';
import { createGuard, type AttemptRecord, type Guard, type Transport } from './guard';
import {
  chatRequest, extractionMessages, HANDLER_LIMITS, insightsMessages, interpretationApi, interpretationInput, ocrMessages,
  realFetchWithBackoff,
  type ChatRequest, type FetchWithBackoff, type HandlerConsole, type ProducedInterpretation,
} from './handlers';
import { RendererUnavailable, type Renderer } from './render';
import { resolveOutDir, table, writeReport, type WrittenImage } from './report';

export interface RunPorts {
  /** The process environment; only CI and AMANI_EVAL_* are read (env.ts). */
  env: Readonly<Record<string, string | undefined>>;
  /** Sends a request in a real run (global fetch). A dry run never calls it. */
  transport: Transport;
  renderer: Renderer;
  /** stdout: the plan, one summary table, the results path. No model text, no key. */
  print: (line: string) => void;
  /** Progress lines (golden-set.eval.ts writes them to stderr). */
  progress?: (line: string) => void;
  tmpdir: string;
  now?: () => number;
}

export interface RunResult {
  ok: boolean;
  /** One line: why the run failed or was refused. */
  reason: string | null;
  outDir: string | null;
  verdicts: TargetVerdict[];
}

/** Input tokens assumed per image when pricing the worst case (an estimate, like the ledger's prices). */
export const IMAGE_TOKEN_ALLOWANCE = 2000;

type Case =
  | { use: 'extraction'; id: string; text: LabText }
  | { use: 'ocr'; id: string; ocr: OcrCase; images: string[] | null }
  | { use: 'interpretation'; id: string; panel: InterpretationPanel }
  | { use: 'labInsights'; id: string; pair: InsightsPair };

interface Slot {
  body: string;
  attemptTimeoutMs: number | null;
  attempts: AttemptRecord[];
  responses: Array<string | null>;
}

interface BuiltRequest {
  use: EvalTarget['use'];
  role: EvalTarget['role'];
  model: string;
  effort: string | null;
  caseId: string;
  body: Record<string, unknown>;
  attemptTimeoutMs: number | null;
}

/** Logical calls a case can make: interpretation retries once with a stricter prompt. */
const callsPerCase = (use: EvalTarget['use']): number => (use === 'interpretation' ? 2 : 1);

function estimateInputTokens(body: Record<string, unknown>): number {
  let images = 0;
  const text = JSON.stringify(body, (_key, value: unknown) => {
    if (typeof value === 'string' && value.startsWith('data:image/')) {
      images += 1;
      return '';
    }
    return value;
  });
  return Math.ceil(text.length / 3) + images * IMAGE_TOKEN_ALLOWANCE;
}

/** What the request can cost at most: its prompt (with margin for a stricter retry) and its full output cap. */
function worstCaseUsd(request: BuiltRequest): number {
  const cap = typeof request.body.max_completion_tokens === 'number' ? request.body.max_completion_tokens
    : typeof request.body.max_tokens === 'number' ? request.body.max_tokens : 0;
  const input = Math.ceil(estimateInputTokens(request.body) * (request.use === 'interpretation' ? 1.2 : 1));
  return estimateCostUsd(request.model, input, cap);
}

/** How a built request differs from what its target must send; empty when it matches. */
export function requestProblems(target: EvalTarget, body: Record<string, unknown>, attemptTimeoutMs: number | null): string[] {
  const problems: string[] = [];
  if (body.model !== target.model) problems.push('model');
  if (!Array.isArray(body.messages) || body.messages.length !== 2) problems.push('messages');
  if (JSON.stringify(body.response_format) !== '{"type":"json_object"}') problems.push('response_format');
  if (body.store !== false) problems.push('store');
  if (attemptTimeoutMs !== HANDLER_LIMITS[target.use].attemptTimeoutMs) problems.push('timeout');
  const limits = isReasoningModel(target.model)
    ? typeof body.max_completion_tokens === 'number' && !('max_tokens' in body) && !('temperature' in body)
    : typeof body.max_tokens === 'number' && !('max_completion_tokens' in body);
  if (!limits) problems.push('limits');
  if ((body.reasoning_effort ?? null) !== target.effort) problems.push('reasoning_effort');
  return problems;
}

function casesOf(fixtures: Fixtures, ocrImages: ReadonlyMap<string, string[]>): Case[] {
  return [
    ...fixtures.texts.map((text): Case => ({ use: 'extraction', id: text.id, text })),
    ...fixtures.ocr.map((ocr): Case => ({ use: 'ocr', id: ocr.id, ocr, images: ocrImages.get(ocr.id) ?? null })),
    ...fixtures.panels.map((panel): Case => ({ use: 'interpretation', id: panel.id, panel })),
    ...fixtures.pairs.map((pair): Case => ({ use: 'labInsights', id: pair.id, pair })),
  ];
}

const DRY_KEY = 'dry-run-placeholder-not-a-key';

export async function runEval(ports: RunPorts): Promise<RunResult> {
  const now = ports.now ?? (() => performance.now());
  const progress = ports.progress ?? (() => {});
  const stop = (reason: string, outDir: string | null = null, verdicts: TargetVerdict[] = []): RunResult => {
    ports.print(reason);
    return { ok: false, reason, outDir, verdicts };
  };

  const read = readEvalConfig(ports.env);
  if (!read.ok) return stop(read.reason);
  const config: EvalConfig = read.config;
  const out = resolveOutDir(config.outDir, ports.tmpdir);
  if (!out.ok) return stop(out.reason);
  const fixtures = loadFixtures();

  // OCR pages, rendered once and held to the handler's own image check first.
  const images: WrittenImage[] = [];
  const ocrImages = new Map<string, string[]>();
  let ocrSkipped: string | null = null;
  if (config.targets.some(t => t.use === 'ocr')) {
    try {
      for (const ocrCase of fixtures.ocr) {
        const rendered: string[] = [];
        for (const [index, page] of ocrCase.pages.entries()) {
          const dataUrl = await ports.renderer.render(pageText(page, fixtures.texts), page.render);
          rendered.push(dataUrl);
          images.push({ name: `ocr-${ocrCase.id}-page${index + 1}.${page.render === 'png' ? 'png' : 'jpg'}`, dataUrl });
        }
        const refused = ocrImagesRefusal(rendered);
        if (refused) return stop(`model eval failed: OCR case ${ocrCase.id} renders images the handler refuses (${refused.body.code})`, out.dir);
        ocrImages.set(ocrCase.id, rendered);
      }
    } catch (error) {
      if (!(error instanceof RendererUnavailable)) throw error;
      ocrSkipped = error.message;
      ocrImages.clear();
      images.length = 0;
    }
  }
  const cases = casesOf(fixtures, ocrImages);

  // Every attempt is recorded into the logical call in progress.
  let slot: Slot | null = null;
  let slots: Slot[] = [];
  const onAttempt = (attempt: AttemptRecord, responseText: string | null) => {
    slot?.attempts.push(attempt);
    slot?.responses.push(responseText);
  };
  const unsent: Transport = async () => new Response(JSON.stringify({ error: { message: 'model eval: not sent' } }), {
    status: 400, headers: { 'content-type': 'application/json' },
  });
  const buildGuard = createGuard(unsent, { maxRequests: Number.MAX_SAFE_INTEGER, now, onAttempt });
  const liveGuard: Guard | null = config.dryRun ? null : createGuard(ports.transport, { maxRequests: config.maxCalls, now, onAttempt });
  let guard: Guard = buildGuard;
  const fetchWithBackoff = realFetchWithBackoff((input, init) => guard.fetch(input, init));
  const recordingFetch: FetchWithBackoff = async (url, init, options) => {
    const mine: Slot = { body: String(init.body), attemptTimeoutMs: options?.attemptTimeoutMs ?? null, attempts: [], responses: [] };
    slots.push(mine);
    slot = mine;
    try {
      return await fetchWithBackoff(url, init, options);
    } finally {
      slot = null;
    }
  };
  const records = (list: readonly Slot[]): CallRecord[] =>
    list.map(s => callRecord(JSON.parse(s.body) as Record<string, unknown>, s.attemptTimeoutMs, s.attempts, s.responses.at(-1) ?? null));

  let handlerLog: string[] = [];
  const logLine = (...args: unknown[]) => {
    handlerLog.push(args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  const quiet: HandlerConsole = { log: logLine, warn: logLine, error: logLine, info: logLine, debug: logLine };
  let activeEnv: Record<string, string> = {};
  const api = interpretationApi({ fetchWithBackoff: recordingFetch, getEnv: name => activeEnv[name], console: quiet });

  const interpretationCase = async (target: EvalTarget, panel: InterpretationPanel, apiKey: string): Promise<{
    produced: ProducedInterpretation; calls: CallRecord[]; samples: GenerationSample[]; log: string[];
  }> => {
    activeEnv = targetEnv(target);
    slots = [];
    handlerLog = [];
    const samples: GenerationSample[] = [];
    const produced = await api.produceInterpretation(interpretationInput(api, panel, apiKey, sample => { samples.push(sample); }));
    return { produced, calls: records(slots), samples, log: handlerLog };
  };

  const chatRequestFor = async (c: Case, target: EvalTarget, apiKey: string): Promise<ChatRequest | null> => {
    const env = targetEnv(target);
    const getEnv = (name: string) => env[name];
    if (c.use === 'extraction') return chatRequest('extraction', getEnv, extractionMessages(c.text.text), apiKey);
    if (c.use === 'ocr') return c.images ? chatRequest('ocr', getEnv, ocrMessages(c.images), apiKey) : null;
    if (c.use === 'labInsights') return chatRequest('labInsights', getEnv, await insightsMessages(insightsInput(c.pair)), apiKey);
    return null;
  };

  // Build and check every request; nothing leaves (the build guard's transport sends nothing).
  const built: BuiltRequest[] = [];
  for (const target of config.targets) {
    for (const c of cases.filter(x => x.use === target.use)) {
      if (c.use === 'ocr' && !c.images) continue;
      let body: Record<string, unknown>;
      let attemptTimeoutMs: number | null;
      if (c.use === 'interpretation') {
        const first = (await interpretationCase(target, c.panel, DRY_KEY)).calls[0];
        if (!first) return stop(`model eval failed: interpretation case ${c.id} built no request`, out.dir);
        body = first.requestBody;
        attemptTimeoutMs = first.attemptTimeoutMs;
      } else {
        const request = (await chatRequestFor(c, target, DRY_KEY))!;
        body = JSON.parse(request.init.body) as Record<string, unknown>;
        attemptTimeoutMs = request.options.attemptTimeoutMs;
      }
      const problems = requestProblems(target, body, attemptTimeoutMs);
      if (problems.length > 0) {
        return stop(`model eval failed: the ${target.use} request for ${c.id} does not match ${targetLabel(target)} (${problems.join(', ')})`, out.dir);
      }
      built.push({ use: target.use, role: target.role, model: target.model, effort: target.effort, caseId: c.id, body, attemptTimeoutMs });
    }
  }

  const planned = built.reduce((n, b) => n + callsPerCase(b.use) * config.repeats, 0);
  const worstCase = built.reduce((sum, b) => sum + callsPerCase(b.use) * config.repeats * worstCaseUsd(b), 0);
  const mode = config.dryRun ? 'dry run (no key, nothing sent)' : 'real run';
  ports.print(`model eval: ${mode}; ${config.targets.length} targets x ${config.repeats} repeats; `
    + `${planned} calls planned (cap ${config.maxCalls}); worst-case estimate $${worstCase.toFixed(2)} at list prices`);
  if (ocrSkipped) ports.print(`OCR SKIPPED: ${ocrSkipped}`);
  if (planned > config.maxCalls) {
    return stop(`model eval refused: ${planned} calls planned, over AMANI_EVAL_MAX_CALLS=${config.maxCalls}; lower AMANI_EVAL_REPEATS or name fewer candidates`, out.dir);
  }

  const header = {
    tool: 'scripts/model-eval (RV-MM1)', synthetic: true, mode: config.dryRun ? 'dry-run' : 'real',
    repeats: config.repeats, maxCalls: config.maxCalls, plannedCalls: planned, worstCaseUsd: Number(worstCase.toFixed(6)),
    targets: config.targets, ocrSkipped,
  };

  if (config.dryRun) {
    const path = writeReport(out.dir, { ...header, requests: built }, images);
    const rows = config.targets.map(t => {
      const mine = built.filter(b => b.use === t.use && b.role === t.role && b.model === t.model && b.effort === t.effort);
      const cap = mine[0]?.body.max_completion_tokens ?? mine[0]?.body.max_tokens;
      return [t.use, t.role, targetLabel(t), t.use === 'ocr' && ocrSkipped ? 'SKIPPED' : `${mine.length} built`,
        String(cap ?? '-'), String(mine[0]?.attemptTimeoutMs ?? '-')];
    });
    for (const line of table(['use', 'role', 'model', 'requests', 'cap', 'timeout ms'], rows)) ports.print(line);
    ports.print(`dry run: ${built.length} requests built and checked; nothing was sent. Requests: ${path}`);
    return { ok: true, reason: null, outDir: out.dir, verdicts: [] };
  }

  // The real run, one call at a time.
  guard = liveGuard!;
  const apiKey = config.apiKey!;
  const checks = new Map<EvalTarget, CaseCheck[]>();
  const caseRecords: unknown[] = [];
  let violation: string | null = null;
  run: for (const target of config.targets) {
    const mine: CaseCheck[] = [];
    checks.set(target, mine);
    if (target.use === 'ocr' && ocrSkipped) continue;
    progress(`model eval: ${target.use} ${target.role} ${targetLabel(target)}`);
    for (const c of cases.filter(x => x.use === target.use)) {
      for (let repeat = 1; repeat <= config.repeats; repeat += 1) {
        const where = { use: target.use, role: target.role, model: target.model, effort: target.effort, caseId: c.id, repeat };
        if (c.use === 'interpretation') {
          const { produced, calls, samples, log } = await interpretationCase(target, c.panel, apiKey);
          const check = checkInterpretation(calls, produced);
          mine.push(check);
          caseRecords.push({ ...where, check, samples, handlerLog: log,
            served: { source: produced.shaped.source, interpretation: produced.interpretationJson, basic: produced.basicProjection } });
        } else {
          slots = [];
          const request = (await chatRequestFor(c, target, apiKey))!;
          try {
            await recordingFetch(request.url, request.init, request.options);
          } catch {
            // The attempts say why; an unanswered call makes the target INCOMPLETE.
          }
          const call = records(slots)[0]!;
          let check: CaseCheck;
          if (c.use === 'labInsights') check = checkInsights(call);
          else if (c.use === 'ocr') {
            const expected: ExpectedRow[] = ocrExpectedRows(c.ocr, fixtures.texts);
            check = checkRows('ocr', call, expected, c.ocr.pages.map(page => pageText(page, fixtures.texts)), c.ocr.printedCycle);
          } else check = checkRows('extraction', call, c.text.rows, [c.text.text]);
          mine.push(check);
          caseRecords.push({ ...where, check });
        }
        if (liveGuard!.violations.length > 0) {
          violation = [...new Set(liveGuard!.violations)].join('; ');
          break run;
        }
      }
    }
  }

  const verdicts = config.targets.map(t => verdictFor(t, checks.get(t) ?? [], t.use === 'ocr' && ocrSkipped !== null));
  const path = writeReport(out.dir, { ...header, sent: liveGuard!.sent, guardViolations: liveGuard!.violations, verdicts, cases: caseRecords }, images);

  const baselineAnswered = (use: EvalTarget['use']) =>
    verdicts.some(v => v.target.use === use && v.target.role === 'baseline' && v.metrics.responses > 0);
  const rows = verdicts.map(v => [
    v.target.use, v.target.role, targetLabel(v.target), v.verdict,
    String(v.metrics.calls), String(v.metrics.responses), String(v.metrics.retries),
    String(v.metrics.latencyP50Ms ?? '-'), String(v.metrics.latencyP95Ms ?? '-'),
    `${v.metrics.reasoningMax ?? '-'}/${v.metrics.cap ?? '-'}`, `$${v.metrics.estCostUsd.toFixed(4)}`, v.metrics.quality,
  ]);
  for (const line of table(['use', 'role', 'model', 'verdict', 'calls', '200s', 'retries', 'p50 ms', 'p95 ms', 'reasoning/cap', 'est cost', 'checks'], rows)) {
    ports.print(line);
  }
  for (const v of verdicts) {
    const name = `${v.target.use} ${v.target.role} ${targetLabel(v.target)}`;
    if (v.verdict === 'BLOCKING') ports.print(`BLOCKING ${name}: ${Object.entries(v.blocking).map(([reason, n]) => `${reason} x${n}`).join(', ')}`);
    if (v.unanswered > 0) ports.print(`INCOMPLETE ${name}: ${v.unanswered} calls without a response after the handler's retries`);
    if (v.target.role === 'candidate' && v.verdict !== 'SKIPPED' && !baselineAnswered(v.target.use)) {
      ports.print(`note ${name}: baseline unavailable (it gave no answer), so these metrics stand alone`);
    }
  }
  if (ocrSkipped) ports.print(`SKIPPED ocr: ${ocrSkipped}`);
  ports.print(`results: ${path}`);

  if (violation) return stop(`model eval failed: guard: ${violation}`, out.dir, verdicts);
  const failing = verdicts.filter(v => v.verdict === 'BLOCKING' || v.verdict === 'INCOMPLETE');
  if (failing.length > 0) {
    return stop(`model eval failed: ${failing.map(v => `${v.target.use} ${targetLabel(v.target)} ${v.verdict}`).join('; ')}`, out.dir, verdicts);
  }
  ports.print('model eval: no BLOCKING verdict; the choice per use is the owner\'s (README.md).');
  return { ok: true, reason: null, outDir: out.dir, verdicts };
}
