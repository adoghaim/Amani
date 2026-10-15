import { describe, expect, it, vi } from 'vitest';
import { AI_PAUSED_CODE, AI_PAUSED_MESSAGE, aiPausedBody, callModelUnlessPaused, isAiPaused } from './ai-pause.ts';
import { createRuntimeConfigReader } from './runtime-config.ts';
import {
  commitGeneratedInterpretation,
  type CommitRequest,
  type DeepAccessDecision,
  type IntroductoryAccessActions,
} from './introductory-access.ts';

/*
  PK-FIX-01b (D5.1, D12, DT9): the AI kill switch as the AI functions apply it.
*/

const rows = (killSwitch: unknown) => [{ key: 'ai_kill_switch', value: killSwitch }];

function readerOver(read: () => Promise<unknown>, now = () => 0) {
  return createRuntimeConfigReader({ readServerConfig: read, now, onError: () => {} });
}

describe('isAiPaused', () => {
  it('is true only while app_server_config.ai_kill_switch is the boolean true', async () => {
    expect(await isAiPaused(readerOver(async () => rows(true)))).toBe(true);
    expect(await isAiPaused(readerOver(async () => rows(false)))).toBe(false);
    expect(await isAiPaused(readerOver(async () => rows('true')))).toBe(false);
    expect(await isAiPaused(readerOver(async () => []))).toBe(false);
  });

  it('a cold-start read failure means AI ON (D5.1)', async () => {
    expect(await isAiPaused(readerOver(async () => { throw new Error('db down'); }))).toBe(false);
  });

  it('a failure after a successful read keeps the last value: a paused switch stays paused', async () => {
    let clock = 0;
    let fail = false;
    const reader = readerOver(async () => {
      if (fail) throw new Error('db down');
      return rows(true);
    }, () => clock);
    expect(await isAiPaused(reader)).toBe(true);
    fail = true;
    clock = 10 * 60 * 1000; // past the 5-minute TTL: a fresh read is attempted, and fails
    expect(await isAiPaused(reader)).toBe(true);
  });

  it('a change reaches the function within the 5-minute cache', async () => {
    let clock = 0;
    let value = false;
    const reader = readerOver(async () => rows(value), () => clock);
    expect(await isAiPaused(reader)).toBe(false);
    value = true;
    clock = 4 * 60 * 1000;
    expect(await isAiPaused(reader)).toBe(false); // still cached
    clock = 5 * 60 * 1000;
    expect(await isAiPaused(reader)).toBe(true);
  });

  it('a reader that throws anyway still answers AI ON', async () => {
    expect(await isAiPaused({ isAiEnabled: async () => { throw new Error('bug'); } })).toBe(false);
  });

  it('carries the D12 shortcut marker at the decision', () => {
    // Read the module source: the marker is a code comment the owner asked for (dec-a6243129).
    return import('node:fs').then(fs => {
      const source = fs.readFileSync(new URL('./ai-pause.ts', import.meta.url), 'utf8');
      expect(source).toContain(
        'gstack-shortcut(dec-a6243129): server-only pause, upgrade when a production pause hits active users',
      );
    });
  });
});

describe('aiPausedBody', () => {
  it('is calm: a code the client recognises and one plain sentence, no error key', () => {
    const body = aiPausedBody();
    expect(body).toEqual({ paused: true, code: AI_PAUSED_CODE, message: AI_PAUSED_MESSAGE });
    expect(body).not.toHaveProperty('error');
    expect(AI_PAUSED_MESSAGE).toBe('Processing is paused right now. Please try again later.');
  });
});

describe('callModelUnlessPaused', () => {
  it('skips the model call while paused, and while it was not wanted', async () => {
    const call = vi.fn(async () => ({ headline: 'x' }));
    expect(await callModelUnlessPaused({ paused: true, wanted: true, call })).toEqual({ result: null, modelCalled: false });
    expect(await callModelUnlessPaused({ paused: false, wanted: false, call })).toEqual({ result: null, modelCalled: false });
    expect(call).not.toHaveBeenCalled();
  });

  it('calls the model once when wanted and not paused', async () => {
    const call = vi.fn(async () => ({ headline: 'x' }));
    expect(await callModelUnlessPaused({ paused: false, wanted: true, call })).toEqual({ result: { headline: 'x' }, modelCalled: true });
    expect(call).toHaveBeenCalledTimes(1);
  });
});

/*
  DT9 (D12): the kill-switch path skips the model call, so
  interpretationGenerated stays false and commitDeepAccess charges nothing.
  This drives the same composition generate-interpretation runs: the paused
  model step, then commitGeneratedInterpretation with
  `interpretationGenerated: aiInterpretation !== null`.
*/
describe('DT9: a paused generation never reaches the claim ledger', () => {
  const grantedWithCredit: DeepAccessDecision = {
    granted: true, reason: 'credit_available', claimsUsed: 0, claimsRemaining: 3, consumesCredit: true,
  };
  const request: CommitRequest = {
    userId: 'u1', reportId: 'r1', bloodDrawId: 'd1', evidenceTier: 'content_hash', interpretation: { headline: 'basic' },
  };

  async function generate(paused: boolean) {
    const model = vi.fn(async () => ({ headline: 'deep' }));
    const commitDeepAccess = vi.fn<IntroductoryAccessActions['commitDeepAccess']>(async () => 'committed');
    const { result: aiInterpretation } = await callModelUnlessPaused({ paused, wanted: true, call: model });
    const committed = await commitGeneratedInterpretation({ commitDeepAccess }, {
      freemiumActive: true,
      tier: 'free',
      decision: grantedWithCredit,
      completion: { parseConfident: true, interpretationGenerated: aiInterpretation !== null },
      request,
    });
    return { model, commitDeepAccess, committed };
  }

  it('paused: no model call, no claim committed, no credit consumed, served as Free', async () => {
    const { model, commitDeepAccess, committed } = await generate(true);
    expect(model).not.toHaveBeenCalled();
    expect(commitDeepAccess).not.toHaveBeenCalled();
    expect(committed).toEqual({ committed: false, tier: 'free' });
  });

  it('control: not paused, the same request commits and consumes the credit', async () => {
    const { model, commitDeepAccess, committed } = await generate(false);
    expect(model).toHaveBeenCalledTimes(1);
    expect(commitDeepAccess).toHaveBeenCalledWith(expect.objectContaining({ consumeCredit: true }));
    expect(committed).toEqual({ committed: true, tier: 'plus' });
  });
});
