// @vitest-environment jsdom
import { act, Component, Suspense, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, lazyWithRetry, pageReload } from './lazyWithRetry';

/*
  Review F072: lazyWithRetry called sessionStorage with no guard. Where storage
  access throws (site data blocked), even a successful import rejected with
  that SecurityError, so every lazy route fell into the error boundary.
*/

const RELOAD_KEY = 'amani:chunk-reload-attempted';

class Catch extends Component<{ children: ReactNode; onError: (error: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { this.props.onError(error); }
  render() { return this.state.failed ? <p>Boundary fallback</p> : this.props.children; }
}

let root: Root;
let app: HTMLDivElement;
let caught: unknown[];
let restoreStorage: (() => void) | null = null;

/** Site data blocked: reading `sessionStorage` itself throws, as browsers do. */
function blockSessionStorage() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
  restoreStorage = () => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    restoreStorage = null;
  };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  caught = [];
  app = document.createElement('div');
  document.body.append(app);
  root = createRoot(app);
});
afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  restoreStorage?.();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderLazy(factory: () => Promise<{ default: () => JSX.Element }>) {
  const Page = lazyWithRetry(factory);
  await act(async () => root.render(
    <Catch onError={error => caught.push(error)}>
      <Suspense fallback={<p>Loading</p>}><Page /></Suspense>
    </Catch>,
  ));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

const page = async () => ({ default: () => <p>Lazy page</p> });

describe('lazyWithRetry with session storage blocked (F072)', () => {
  it('still renders a lazy route whose code loaded', async () => {
    blockSessionStorage();
    await renderLazy(page);
    expect(app.textContent).toBe('Lazy page');
    expect(caught).toEqual([]);
  });

  it('in production, a failed load reaches the boundary as itself and never reloads: without the flag a reload could repeat forever', async () => {
    vi.stubEnv('PROD', true);
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {});
    blockSessionStorage();
    const chunkError = new TypeError('Failed to fetch dynamically imported module');
    await renderLazy(() => Promise.reject(chunkError));
    expect(app.textContent).toBe('Boundary fallback');
    expect(caught).toEqual([chunkError]);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('lazyWithRetry with working storage (unchanged behaviour)', () => {
  it('a successful load clears the reload flag', async () => {
    sessionStorage.setItem(RELOAD_KEY, '1');
    await renderLazy(page);
    expect(app.textContent).toBe('Lazy page');
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });

  it('in production, the first failed load reloads once and records it; a second failure surfaces instead', async () => {
    vi.stubEnv('PROD', true);
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {});
    const chunkError = new TypeError('Failed to fetch dynamically imported module');
    await renderLazy(() => Promise.reject(chunkError));
    expect(reload).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBe('1');

    await act(async () => root.unmount());
    root = createRoot(app);
    caught = [];
    await renderLazy(() => Promise.reject(chunkError));
    expect(reload).toHaveBeenCalledOnce();
    expect(caught).toEqual([chunkError]);
  });

  it('outside production it never reloads', async () => {
    const reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => {});
    await renderLazy(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module')));
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RELOAD_KEY)).toBeNull();
  });
});

describe('isChunkLoadError', () => {
  it('marks only what a lazy route threw while loading its code', async () => {
    const chunkError = new TypeError('Failed to fetch dynamically imported module');
    await renderLazy(() => Promise.reject(chunkError));
    expect(caught).toEqual([chunkError]);
    expect(isChunkLoadError(chunkError)).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module'))).toBe(false);
    expect(isChunkLoadError(new Error('render failed'))).toBe(false);
    expect(isChunkLoadError('string')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
