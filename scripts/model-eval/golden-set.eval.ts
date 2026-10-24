/**
 * The owner-run synthetic model eval (RV-MM1). Never in CI: there is no npm
 * script or workflow for it, CI's Vitest config does not include *.eval.ts,
 * and the run refuses when CI is set. Run it only as README.md says:
 *
 *   AMANI_EVAL_DRY_RUN=1 npx vitest run -c scripts/model-eval/vitest.eval.config.ts
 *   AMANI_EVAL_OPENAI_API_KEY=<eval-only key> npx vitest run -c scripts/model-eval/vitest.eval.config.ts
 */
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { playwrightRenderer } from './render';
import { runEval } from './run';

it('synthetic golden set: baseline and candidate models per use (README.md)', async () => {
  const renderer = playwrightRenderer();
  try {
    const result = await runEval({
      env: process.env,
      transport: (url, init) => fetch(url, init),
      renderer,
      print: line => { process.stdout.write(`${line}\n`); },
      progress: line => { process.stderr.write(`${line}\n`); },
      tmpdir: tmpdir(),
    });
    if (!result.ok) expect.fail(result.reason ?? 'model eval failed');
  } finally {
    await renderer.close();
  }
});
