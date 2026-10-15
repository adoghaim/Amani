/**
 * What the app knows about her launch consent, shared by the gate and Settings
 * (PK-CONSENT-01). One read per user per launch; the gate and Settings update
 * it as she answers, so a route change does not read again.
 *
 *   off      features.consent_gate is off: today's behaviour, nothing is read.
 *   loading  her answers are being read.
 *   ready    `missing` lists the consent types she has not currently granted.
 *   error    her answers could not be read: the gate fails closed (Retry).
 *
 * The flag comes from src/lib/runtimeConfig.ts in two steps, so that flag off
 * keeps today's timing exactly (no wait on the launch config read):
 *   1. at once, from what runtimeConfig holds now (last launch's copy while
 *      this launch's read is in flight, else off);
 *   2. again when this launch's read settles (or after CONFIG_WAIT_MS), and if
 *      the answer changed, the gate follows it: a cached "off" never outlives
 *      the read that says the owner has switched the gate on.
 * The window between the two is the one launch after a flip on a device that
 * had cached "off"; the server checks every upload and AI request regardless.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { isFeatureEnabled, loadRuntimeConfig } from '../runtimeConfig';
import { readMissingConsents } from './consentApi';
import { CONSENT_GATE_FLAG, CONSENT_TYPES, type ConsentType } from './consentPolicy';

export type ConsentState =
  | { status: 'idle' }
  | { status: 'off' }
  | { status: 'loading'; userId: string }
  | { status: 'ready'; userId: string; missing: readonly ConsentType[] }
  | { status: 'error'; userId: string };

export interface ConsentStoreDeps {
  /** The flag as runtimeConfig answers right now. */
  gateEnabledNow(): boolean;
  /** The flag once this launch's config read has settled, or CONFIG_WAIT_MS has passed. */
  gateEnabledSettled(): Promise<boolean>;
  readMissing(userId: string): Promise<ConsentType[]>;
}

/** The longest the settled answer waits for a config read that has not finished. */
export const CONFIG_WAIT_MS = 5000;

const defaultDeps: ConsentStoreDeps = {
  gateEnabledNow: () => isFeatureEnabled(CONSENT_GATE_FLAG),
  async gateEnabledSettled() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      loadRuntimeConfig(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, CONFIG_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    return isFeatureEnabled(CONSENT_GATE_FLAG);
  },
  readMissing: readMissingConsents,
};

let deps: ConsentStoreDeps = defaultDeps;
let state: ConsentState = { status: 'idle' };
let generation = 0;
/** The user the store is answering for; null after a reset. */
let currentUser: string | null = null;
/** This launch's settled flag, once known. */
let settledFlag: boolean | null = null;
let settling: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: ConsentState) {
  state = next;
  listeners.forEach(listener => listener());
}

export function consentState(): ConsentState {
  return state;
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function flagNow(): boolean {
  if (settledFlag !== null) return settledFlag;
  try {
    return deps.gateEnabledNow();
  } catch {
    return false; // runtime config fails open by design (PK-CFG-01): no flag, no gate.
  }
}

async function decide(userId: string, on: boolean, mine: number): Promise<void> {
  if (!on) {
    set({ status: 'off' });
    return;
  }
  set({ status: 'loading', userId });
  try {
    const missing = await deps.readMissing(userId);
    if (mine === generation) set({ status: 'ready', userId, missing });
  } catch {
    if (mine === generation) set({ status: 'error', userId });
  }
}

function watchSettle(): Promise<void> {
  settling ??= deps.gateEnabledSettled().catch(() => false).then(async on => {
    settledFlag = on;
    const user = currentUser;
    if (!user || state.status === 'idle') return;
    const wasOn = state.status !== 'off';
    if (wasOn !== on) await decide(user, on, ++generation);
  });
  return settling;
}

/**
 * Decides the gate for this user and, when it is on, reads her answers. Later
 * calls for the same user reuse the result; `force` reads again (Try again).
 * Resolves once the settled flag has been applied too.
 */
export async function loadConsent(userId: string, force = false): Promise<void> {
  const sameUser = currentUser === userId;
  currentUser = userId;
  const reuse = !force && state.status !== 'idle' && state.status !== 'error'
    && (state.status === 'off' || ('userId' in state && state.userId === userId && sameUser));
  if (!reuse) await decide(userId, flagNow(), ++generation);
  if (settledFlag === null) await watchSettle();
}

/** She granted (true) or withdrew (false) these types; the ledger write has succeeded. */
export function noteAnswers(userId: string, types: readonly ConsentType[], granted: boolean): void {
  if (state.status !== 'ready' || state.userId !== userId) return;
  const missing = new Set(state.missing);
  for (const type of types) {
    if (granted) missing.delete(type);
    else missing.add(type);
  }
  set({ status: 'ready', userId, missing: CONSENT_TYPES.filter(type => missing.has(type)) });
}

/** Forget her answers (sign-out, erasure). This launch's settled flag stays known. */
export function resetConsent(): void {
  generation++;
  currentUser = null;
  set({ status: 'idle' });
}

/** Tests only: new deps, and a fresh launch. */
export function setConsentStoreDepsForTests(next: ConsentStoreDeps | null): void {
  deps = next ?? defaultDeps;
  settledFlag = null;
  settling = null;
  resetConsent();
}

/** The consent state for this user, loading it on first use. */
export function useConsent(userId: string | null | undefined): ConsentState {
  const current = useSyncExternalStore(subscribeConsent, consentState, consentState);
  useEffect(() => {
    if (userId) void loadConsent(userId);
  }, [userId]);
  if (!userId) return { status: 'idle' };
  if (current.status === 'off') return current;
  if ('userId' in current && current.userId === userId) return current;
  return { status: 'loading', userId };
}

/** features.consent_gate, once the launch config read has settled (or CONFIG_WAIT_MS has passed). */
export function consentGateEnabled(): Promise<boolean> {
  return settledFlag !== null ? Promise.resolve(settledFlag) : deps.gateEnabledSettled().catch(() => false);
}

/** For pages that only add a line while the gate is on (Privacy). False until known. */
export function useConsentGateFlag(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    void consentGateEnabled().then(value => { if (live) setOn(value); });
    return () => { live = false; };
  }, []);
  return on;
}
