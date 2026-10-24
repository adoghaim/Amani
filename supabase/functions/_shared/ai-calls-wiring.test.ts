import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chatCompletionParams, DEFAULT_OPENAI_MODELS } from './openai-models.ts';

/*
  AI1 (F017, F033, F128, F131): lab-insights, parse-lab-report-ocr and
  extract-biomarkers are Deno handlers Vitest cannot import, so this reads their
  source and pins the wiring the pure modules rely on (openai-models.ts,
  lab-insights-policy.ts, phi-scrub.ts). The behaviour behind each module is
  proved in its own suite.
*/

const source = (fn: string) => readFileSync(new URL(`../${fn}/index.ts`, import.meta.url), 'utf8');
const FUNCTIONS = ['lab-insights', 'parse-lab-report-ocr', 'extract-biomarkers'] as const;

describe.each(FUNCTIONS.map(fn => [fn]))('%s', fn => {
  const text = source(fn);

  it('takes its model id and request parameters from _shared/openai-models.ts (F128)', () => {
    expect(text).toContain('from "../_shared/openai-models.ts"');
    expect(text).toMatch(/resolveOpenAiModel\("/);
    expect(text).toContain('...chatCompletionParams(model,');
    expect(text).not.toMatch(/model: "gpt-/);
    expect(text).not.toMatch(/: "gpt-[\w.-]+"/);
    // No hand-written sampling or limit field survives outside the helper's call.
    const outsideHelper = text.replace(/chatCompletionParams\([^)]*\)/g, '');
    expect(outsideHelper).not.toMatch(/\btemperature:/);
    expect(outsideHelper).not.toMatch(/\bmax_(?:completion_)?tokens:/);
  });

  it('returns a fixed message to the client and logs scrubbed detail (F033)', () => {
    expect(text).not.toContain('errorMessage(');
    expect(text).not.toContain('_shared/errors.ts');
    expect(text).not.toMatch(/new Error\(`OpenAI API error: \$\{(?!openaiResponse\.status)/);
    expect(text).not.toMatch(/console\.error\("[^"]*",\s*error\)/);
    expect(text).not.toMatch(/console\.error\("OpenAI API error:",\s*errorData\)/);
    expect(text).toContain('errorType(error), scrubbedErrorMessage(error)');
    const catchBlock = text.slice(text.lastIndexOf('} catch (error: unknown)'));
    expect(catchBlock).toMatch(/error: "(?:Internal server error|Failed to generate insights)"/);
  });
});

describe.each([['parse-lab-report-ocr'], ['extract-biomarkers']])('%s OpenAI error body (F033)', fn => {
  it('is logged only through the PHI scrub, with its status', () => {
    expect(source(fn)).toContain('console.error("OpenAI API error:", openaiResponse.status, scrubServerText(errorData));');
  });
});

describe('lab-insights (F017, F131)', () => {
  const text = source('lab-insights');

  it('runs the nutrient policy over the model output before returning it', () => {
    expect(text).toContain('from "../_shared/lab-insights-policy.ts"');
    expect(text).toMatch(/enforceLabInsightsPolicy\(parsedInsights\)/);
    // The policy runs after the shape parse and before the success response.
    expect(text.indexOf('parseLabInsightsCompletion(openaiData)'))
      .toBeLessThan(text.indexOf('enforceLabInsightsPolicy('));
    expect(text.indexOf('enforceLabInsightsPolicy('))
      .toBeLessThan(text.indexOf('JSON.stringify({\n        insights,'));
  });

  it('puts the policy rules in the prompt and keeps raw intervention titles out of it', () => {
    expect(text).toContain('${labInsightsPolicyPrompt()}');
    expect(text).toContain('promptInterventionLabel(i.title, i.category)');
    expect(text).not.toMatch(/`- \$\{i\.title\}/);
    expect(text).toContain('.slice(0, MAX_PROMPT_INTERVENTIONS)');
  });

  it('sends the policy prompt to the model through the redaction step', () => {
    expect(text).toContain('redactLabText(prompt).text');
  });

  it('builds a request body gpt-5-mini accepts: no temperature, max_completion_tokens', () => {
    const params = chatCompletionParams(DEFAULT_OPENAI_MODELS.labInsights, { maxOutputTokens: 3000, temperature: 0.7 });
    expect(Object.keys(params)).toEqual(['max_completion_tokens']);
    expect(text).toContain('chatCompletionParams(model, { maxOutputTokens: 3000, temperature: 0.7 })');
  });
});
