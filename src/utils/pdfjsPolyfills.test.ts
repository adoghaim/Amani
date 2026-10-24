// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { transformWithEsbuild } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';

/*
  F062, wave 3 — behaviour of the hand-written pdf.js polyfills
  (src/utils/pdfjsPolyfills.ts), compiled exactly as the `?lowered-url` plugin
  compiles them for the worker (esbuild IIFE). Each test runs them in a fresh
  V8 realm (node:vm) where the APIs were deleted first, so the test runner's own
  built-ins are never touched, and compares the results with this engine's
  native implementations. pdfWorkerTarget.test.ts covers the built files.
*/
let polyfillCode = '';
// Errors thrown in the vm realm are that realm's TypeError, not this one's.
const REALM_TYPE_ERROR = expect.objectContaining({ name: 'TypeError' });

beforeAll(async () => {
  const file = fileURLToPath(new URL('./pdfjsPolyfills.ts', import.meta.url));
  polyfillCode = (await transformWithEsbuild(readFileSync(file, 'utf-8'), file, { format: 'iife', target: 'es2018' })).code;
});

const DELETE_IN_REALM = `
  const TA = Object.getPrototypeOf(Int8Array.prototype);
  delete Promise.withResolvers;
  delete Object.hasOwn;
  for (const p of [Array.prototype, String.prototype, TA]) delete p.at;
  for (const p of [Array.prototype, TA]) { delete p.findLast; delete p.findLastIndex; }
  delete ArrayBuffer.prototype.transferToFixedLength;
`;

/** A fresh realm without the APIs, then the polyfills. Web classes are host subclasses with the API masked. */
function oldRealm() {
  class OldReadableStream<R> extends ReadableStream<R> {}
  class OldResponse extends Response {}
  class OldBlob extends Blob {}
  for (const proto of [OldReadableStream.prototype, OldResponse.prototype, OldBlob.prototype]) {
    for (const key of [Symbol.asyncIterator, 'values', 'bytes']) {
      Object.defineProperty(proto, key, { value: undefined, configurable: true, writable: true });
    }
  }
  const context = vm.createContext({
    ReadableStream: OldReadableStream,
    Response: OldResponse,
    Blob: OldBlob,
    DOMException,
  });
  vm.runInContext(DELETE_IN_REALM, context);
  const missingBefore = vm.runInContext(
    `[typeof Promise.withResolvers, typeof [].at, typeof structuredClone, typeof ReadableStream.prototype[Symbol.asyncIterator]]`,
    context,
  ) as string[];
  expect(missingBefore).toEqual(['undefined', 'undefined', 'undefined', 'undefined']);
  vm.runInContext(polyfillCode, context);
  const run = <T>(code: string): T => vm.runInContext(code, context) as T;
  return { run, OldReadableStream, OldResponse, OldBlob };
}

describe('pdfjsPolyfills: installs only what is missing', () => {
  it('leaves native implementations in place', () => {
    const context = vm.createContext({ ReadableStream, Response, Blob, DOMException });
    const KEPT = '[Array.prototype.at, Object.hasOwn, Array.prototype.findLast, Promise.withResolvers, ReadableStream.prototype[Symbol.asyncIterator], Response.prototype.bytes]';
    vm.runInContext(`globalThis.saved = ${KEPT};`, context);
    vm.runInContext(polyfillCode, context);
    expect(vm.runInContext(`saved.every(f => typeof f === 'function') && ${KEPT}.every((f, i) => f === saved[i])`, context)).toBe(true);
  });

  it('installs non-enumerable methods, as built-ins are', () => {
    const { run } = oldRealm();
    expect(run<string[]>('Object.keys(Array.prototype).concat(Object.keys(Promise), Object.keys(Object))')).toEqual([]);
    expect(run<boolean>("Object.getOwnPropertyDescriptor(Array.prototype, 'at').enumerable")).toBe(false);
  });
});

describe('pdfjsPolyfills: ES built-ins match the native ones', () => {
  it('Promise.withResolvers resolves and rejects', async () => {
    const { run } = oldRealm();
    const resolved = run<Promise<unknown>>('(() => { const d = Promise.withResolvers(); d.resolve(42); return d.promise; })()');
    await expect(resolved).resolves.toBe(42);
    const rejected = run<Promise<unknown>>("(() => { const d = Promise.withResolvers(); d.reject(new Error('no')); return d.promise; })()");
    await expect(rejected).rejects.toThrow('no');
    expect(run<boolean>('(() => { class P extends Promise {} return P.withResolvers().promise instanceof P; })()')).toBe(true);
  });

  it('.at on arrays, strings and typed arrays', () => {
    const { run } = oldRealm();
    const INDICES = "[0, 1, 2, -1, -3, -4, 3, 1.7, -1.2, NaN, Infinity, -Infinity, '1', undefined, null, '-2']";
    const TABLE = `${INDICES}.map(i => [[10, 20, 30].at(i), 'abc'.at(i), new Uint8Array([7, 8, 9]).at(i), new Float64Array([0.5, 1.5, 2.5]).at(i)])`;
    // The same expression in the old realm (polyfilled) and in this engine (native).
    expect(run<unknown[][]>(TABLE)).toEqual(vm.runInNewContext(TABLE));
    expect(run<string>("'😀x'.at(0)")).toBe(vm.runInNewContext("'😀x'.at(0)")); // a UTF-16 code unit, as natively
    expect(run<unknown>("Array.prototype.at.call({ length: 2, 0: 'a', 1: 'b' }, -1)")).toBe('b');
    expect(() => run("Array.prototype.at.call(null, 0)")).toThrow(REALM_TYPE_ERROR);
  });

  it('findLast / findLastIndex on arrays and typed arrays', () => {
    const { run } = oldRealm();
    expect(run<unknown[]>(`[
      [1, 2, 3, 4].findLast(v => v % 2 === 1),
      [1, 2, 3, 4].findLastIndex(v => v % 2 === 1),
      [1, 2].findLast(v => v > 5),
      [1, 2].findLastIndex(v => v > 5),
      new Int16Array([5, -1, 6]).findLast(v => v > 0),
      new Int16Array([5, -1, 6]).findLastIndex(v => v < 0),
      ['a', 'b'].findLast(function (v, i, o) { return this.want === v && o.length === 2 && i === 0; }, { want: 'a' }),
    ]`)).toEqual([
      3,
      2,
      undefined,
      -1,
      6,
      1,
      'a',
    ]);
    expect(() => run('[1].findLast(null)')).toThrow(REALM_TYPE_ERROR);
    // Visits from the end: the predicate sees the last element first.
    expect(run<number[]>('(() => { const seen = []; [1, 2, 3].findLastIndex(v => { seen.push(v); return false; }); return seen; })()')).toEqual([3, 2, 1]);
  });

  it('Object.hasOwn', () => {
    const { run } = oldRealm();
    expect(run<boolean[]>("[Object.hasOwn({ a: 1 }, 'a'), Object.hasOwn({ a: 1 }, 'toString'), Object.hasOwn(Object.create({ a: 1 }), 'a'), Object.hasOwn([1], 0), Object.hasOwn('ab', 'length')]")).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
    expect(() => run("Object.hasOwn(null, 'a')")).toThrow(REALM_TYPE_ERROR);
  });

  it('ArrayBuffer#transferToFixedLength trims, grows with zeros and keeps content', () => {
    const { run } = oldRealm();
    expect(run<number[][]>(`(() => {
      const src = new Uint8Array([1, 2, 3, 4]).buffer;
      return [
        Array.from(new Uint8Array(src.transferToFixedLength(2))),
        Array.from(new Uint8Array(src.transferToFixedLength(6))),
        Array.from(new Uint8Array(src.transferToFixedLength())),
      ];
    })()`)).toEqual([[1, 2], [1, 2, 3, 4, 0, 0], [1, 2, 3, 4]]);
  });
});

describe('pdfjsPolyfills: structuredClone', () => {
  it('deep-copies the value kinds pdf.js posts, keeping shared and circular references', () => {
    const { run } = oldRealm();
    const summary = run<Record<string, unknown>>(`(() => {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      const a = new Uint8Array(buf, 1, 2);
      const b = new Float32Array([1.5]);
      const src = {
        n: 1, s: 'x', nil: null, undef: undefined, big: 10n, neg0: -0,
        arr: [1, [2, { deep: true }]], map: new Map([['k', { v: 1 }]]), set: new Set([1, 'two']),
        date: new Date(5), re: /ab+c/gi, err: new RangeError('bad'), boxed: new Number(3),
        a, a2: new Uint16Array(buf), b, view: new DataView(buf, 2),
      };
      src.self = src;
      const out = structuredClone(src);
      return {
        distinct: out !== src && out.arr !== src.arr && out.map !== src.map && out.a.buffer !== buf,
        circular: out.self === out,
        sharedBuffer: out.a.buffer === out.a2.buffer && out.a.buffer === out.view.buffer,
        primitives: [out.n, out.s, out.nil, 'undef' in out, out.undef, out.big === 10n, Object.is(out.neg0, -0)],
        arr: JSON.stringify(out.arr),
        map: out.map instanceof Map && out.map.get('k').v === 1 && out.map.get('k') !== src.map.get('k'),
        set: out.set instanceof Set && out.set.has('two') && out.set.size === 2,
        date: out.date instanceof Date && out.date.getTime() === 5,
        re: out.re instanceof RegExp && out.re.source === 'ab+c' && out.re.flags === 'gi',
        err: out.err instanceof RangeError && out.err.message === 'bad',
        boxed: out.boxed instanceof Number && out.boxed.valueOf() === 3,
        a: out.a instanceof Uint8Array && Array.from(out.a).join() === '2,3' && out.a.byteOffset === 1,
        b: out.b instanceof Float32Array && out.b[0] === 1.5,
        view: out.view instanceof DataView && out.view.byteOffset === 2 && out.view.getUint8(0) === 3,
        independent: (() => { out.a[0] = 99; return new Uint8Array(buf)[1] === 2; })(),
      };
    })()`);
    expect(summary).toEqual({
      distinct: true,
      circular: true,
      sharedBuffer: true,
      primitives: [1, 'x', null, true, undefined, true, true],
      arr: '[1,[2,{"deep":true}]]',
      map: true,
      set: true,
      date: true,
      re: true,
      err: true,
      boxed: true,
      a: true,
      b: true,
      view: true,
      independent: true,
    });
  });

  it('passes transferred buffers by reference and copies the rest', () => {
    const { run } = oldRealm();
    expect(run<boolean[]>(`(() => {
      const moved = new ArrayBuffer(8);
      const kept = new ArrayBuffer(8);
      const out = structuredClone({ moved: new Uint8Array(moved), kept }, { transfer: [moved] });
      return [out.moved.buffer === moved, out.kept !== kept, out.kept.byteLength === 8];
    })()`)).toEqual([true, true, true]);
  });

  it('throws DataCloneError for functions and symbols, as natively', () => {
    const { run } = oldRealm();
    expect(() => run('structuredClone({ f() {} })')).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => run('structuredClone(Symbol("s"))')).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
    expect(() => structuredClone({ f() {} })).toThrow(expect.objectContaining({ name: 'DataCloneError' }));
  });
});

describe('pdfjsPolyfills: web APIs', () => {
  const chunks = (values: number[], onCancel?: (reason: unknown) => void) =>
    new ReadableStreamSource(values, onCancel);

  class ReadableStreamSource {
    constructor(
      private values: number[],
      private onCancel?: (reason: unknown) => void,
    ) {}
    start(controller: ReadableStreamDefaultController<number>) {
      for (const v of this.values) controller.enqueue(v);
      controller.close();
    }
    cancel(reason: unknown) {
      this.onCancel?.(reason);
    }
  }

  it('iterates a ReadableStream with for await, then releases the lock', async () => {
    const { OldReadableStream } = oldRealm();
    const stream = new OldReadableStream<number>(chunks([1, 2, 3]));
    const seen: number[] = [];
    for await (const v of stream as unknown as AsyncIterable<number>) seen.push(v);
    expect(seen).toEqual([1, 2, 3]);
    expect(stream.locked).toBe(false);
  });

  it('cancels the stream on an early exit unless preventCancel is set', async () => {
    const { OldReadableStream } = oldRealm();
    const reasons: unknown[] = [];
    const stream = new OldReadableStream<number>(chunks([1, 2, 3], r => reasons.push(r)));
    for await (const v of stream as unknown as AsyncIterable<number>) {
      if (v === 1) break;
    }
    expect(reasons).toHaveLength(1);
    expect(stream.locked).toBe(false);

    const kept = new OldReadableStream<number>(chunks([1, 2, 3], r => reasons.push(r)));
    const values = (kept as unknown as { values(o: { preventCancel: boolean }): AsyncIterableIterator<number> }).values({ preventCancel: true });
    expect(await values.next()).toEqual({ done: false, value: 1 });
    await values.return?.();
    expect(reasons).toHaveLength(1);
    expect(kept.locked).toBe(false);
  });

  it('rejects and releases the lock when the stream errors', async () => {
    const { OldReadableStream } = oldRealm();
    const stream = new OldReadableStream<number>({
      pull(controller) {
        controller.error(new Error('broken'));
      },
    });
    const iterate = async () => {
      for await (const _ of stream as unknown as AsyncIterable<number>) {
        // never reached
      }
    };
    await expect(iterate()).rejects.toThrow('broken');
    expect(stream.locked).toBe(false);
  });

  it('Response#bytes and Blob#bytes return a Uint8Array of the body', async () => {
    const { OldResponse, OldBlob } = oldRealm();
    const fromResponse = await (new OldResponse(new Uint8Array([1, 2, 3])) as unknown as { bytes(): Promise<Uint8Array> }).bytes();
    const fromBlob = await (new OldBlob([new Uint8Array([4, 5])]) as unknown as { bytes(): Promise<Uint8Array> }).bytes();
    expect(Object.prototype.toString.call(fromResponse)).toBe('[object Uint8Array]');
    expect(Array.from(fromResponse)).toEqual([1, 2, 3]);
    expect(Array.from(fromBlob)).toEqual([4, 5]);
  });
});
