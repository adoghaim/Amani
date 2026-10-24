/*
  Runtime APIs pdfjs-dist 6.4.299 (legacy build) calls without a guard or a
  polyfill of its own, on the engines the app still ships to
  (IPHONEOS_DEPLOYMENT_TARGET 15.0, Android 7 WebView). The legacy build's
  core-js covers Promise.try, Uint8Array hex/base64, Set methods, iterator
  helpers and URL.parse; it does not cover these:

    Promise.withResolvers                         WebKit 17.4, Chrome 119
    Array / String / TypedArray .at, Object.hasOwn WebKit 15.4, Chrome 92-93
    Array / TypedArray .findLast, .findLastIndex  WebKit 15.4, Chrome 97
    structuredClone (fake-worker LoopbackPort)    WebKit 15.4, Chrome 98
    ArrayBuffer#transferToFixedLength (fonts)     WebKit 17.4, Chrome 114
    ReadableStream async iteration                WebKit 27,   Chrome 124
      (page.getTextContent() is `for await (const v of readableStream)`)
    Response#bytes, Blob#bytes                    WebKit 18,   Chrome 132

  This file runs twice: imported on the main thread before pdf.mjs
  (src/utils/pdfExtractor.ts), and prepended to the pdf.js worker by the
  `?lowered-url` plugin in vite.config.ts, because the worker is its own realm.
  So it must stay self-contained: no imports, no exports, nothing that needs a
  DOM. Each polyfill installs only when the API is missing, so modern engines
  keep their native implementations. Guarded by src/utils/pdfjsPolyfills.test.ts
  (behaviour) and src/utils/pdfWorkerTarget.test.ts (the built files on an
  engine without these APIs).

  Hand-written rather than core-js on purpose: core-js has no ReadableStream
  async-iteration polyfill, and putting its CommonJS modules into the worker
  would need a bundling step in the plugin instead of a plain transform.
*/
// Modules are strict already; this makes the IIFE build of this file strict too, so `this` stays unboxed.
'use strict';

type AnyFn = (...args: never[]) => unknown;

function install(target: object | undefined, key: PropertyKey, value: AnyFn) {
  if (!target || typeof (target as Record<PropertyKey, unknown>)[key] === 'function') return;
  Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: false });
}

function toLength(value: unknown): number {
  const n = Math.trunc(Number(value)) || 0;
  return Math.min(Math.max(n, 0), Number.MAX_SAFE_INTEGER);
}

function relativeIndex(index: unknown, length: number): number {
  const k = Math.trunc(Number(index)) || 0;
  return k < 0 ? k + length : k;
}

function requireCallable(fn: unknown): asserts fn is (v: unknown, i: number, o: unknown) => unknown {
  if (typeof fn !== 'function') throw new TypeError(`${String(fn)} is not a function`);
}

install(Promise, 'withResolvers', function withResolvers<T>(this: PromiseConstructor) {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new this<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
});

install(Object, 'hasOwn', function hasOwn(object: unknown, key: PropertyKey) {
  if (object == null) throw new TypeError('Cannot convert undefined or null to object');
  return Object.prototype.hasOwnProperty.call(object, key);
});

const typedArrayProto: object | undefined =
  typeof Int8Array === 'function' ? Object.getPrototypeOf(Int8Array.prototype) : undefined;

function at(this: ArrayLike<unknown>, index: unknown) {
  if (this == null) throw new TypeError('at called on null or undefined');
  const o = Object(this) as ArrayLike<unknown>;
  const length = toLength(o.length);
  const k = relativeIndex(index, length);
  return k < 0 || k >= length ? undefined : o[k];
}
install(Array.prototype, 'at', at);
install(typedArrayProto, 'at', at);
install(String.prototype, 'at', function stringAt(this: unknown, index: unknown) {
  if (this == null) throw new TypeError('String.prototype.at called on null or undefined');
  const s = String(this);
  const k = relativeIndex(index, s.length);
  return k < 0 || k >= s.length ? undefined : s.charAt(k);
});

function findLastIndex(this: ArrayLike<unknown>, predicate: unknown, thisArg?: unknown) {
  if (this == null) throw new TypeError('findLastIndex called on null or undefined');
  const o = Object(this) as ArrayLike<unknown>;
  requireCallable(predicate);
  for (let i = toLength(o.length) - 1; i >= 0; i--) {
    if (predicate.call(thisArg, o[i], i, o)) return i;
  }
  return -1;
}
function findLast(this: ArrayLike<unknown>, predicate: unknown, thisArg?: unknown) {
  if (this == null) throw new TypeError('findLast called on null or undefined');
  const o = Object(this) as ArrayLike<unknown>;
  requireCallable(predicate);
  for (let i = toLength(o.length) - 1; i >= 0; i--) {
    const value = o[i];
    if (predicate.call(thisArg, value, i, o)) return value;
  }
  return undefined;
}
install(Array.prototype, 'findLast', findLast);
install(Array.prototype, 'findLastIndex', findLastIndex);
install(typedArrayProto, 'findLast', findLast);
install(typedArrayProto, 'findLastIndex', findLastIndex);

/*
  Copies instead of detaching (an engine without the method cannot detach a
  buffer from script). pdf.js only calls it to trim a buffer it then hands over
  and never touches again (compileFontInfo / compileSystemFontInfo).
*/
install(ArrayBuffer.prototype, 'transferToFixedLength', function transferToFixedLength(
  this: ArrayBuffer,
  newLength?: unknown,
) {
  const length = newLength === undefined ? this.byteLength : toLength(newLength);
  const copy = new ArrayBuffer(length);
  new Uint8Array(copy).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
  return copy;
});

function dataCloneError(message: string): Error {
  return typeof DOMException === 'function' ? new DOMException(message, 'DataCloneError') : new TypeError(message);
}

/*
  The structured-clone algorithm for the values pdf.js posts between its main
  thread and a fake worker: primitives, plain objects, arrays, Map, Set, Date,
  RegExp, Error, boxed primitives, ArrayBuffer, typed arrays and DataView, with
  shared and circular references preserved. Functions and symbols throw
  DataCloneError as natively. A buffer listed in `transfer` is passed by
  reference (script cannot detach it); everything else is copied. Host objects
  (Blob, ImageBitmap, MessagePort) pass through by reference.
*/
install(globalThis, 'structuredClone', function structuredClone(value: unknown, options?: { transfer?: Iterable<unknown> } | null) {
  const transfer = new Set<unknown>(options?.transfer ? Array.from(options.transfer) : []);
  const seen = new Map<object, unknown>();
  const tagOf = (v: object) => Object.prototype.toString.call(v).slice(8, -1);

  const clone = (v: unknown): unknown => {
    if (typeof v === 'function' || typeof v === 'symbol') throw dataCloneError(`${String(v)} could not be cloned.`);
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    const remember = <T>(out: T): T => {
      seen.set(v, out);
      return out;
    };
    if (transfer.has(v)) return remember(v);
    const tag = tagOf(v);
    if (tag === 'ArrayBuffer') return remember((v as ArrayBuffer).slice(0));
    if (ArrayBuffer.isView(v)) {
      const buffer = clone(v.buffer) as ArrayBuffer;
      if (tag === 'DataView') return remember(new DataView(buffer, v.byteOffset, v.byteLength));
      const Ctor = (v as unknown as { constructor: new (b: ArrayBuffer, o: number, l: number) => unknown }).constructor;
      return remember(new Ctor(buffer, v.byteOffset, (v as unknown as ArrayLike<unknown>).length));
    }
    if (tag === 'Date') return remember(new Date((v as Date).getTime()));
    if (tag === 'RegExp') return remember(new RegExp((v as RegExp).source, (v as RegExp).flags));
    if (tag === 'Boolean' || tag === 'Number' || tag === 'String' || tag === 'BigInt') {
      return remember(Object((v as { valueOf(): unknown }).valueOf()));
    }
    if (tag === 'Map') {
      const out = remember(new Map());
      for (const [k, val] of v as Map<unknown, unknown>) out.set(clone(k), clone(val));
      return out;
    }
    if (tag === 'Set') {
      const out = remember(new Set());
      for (const val of v as Set<unknown>) out.add(clone(val));
      return out;
    }
    if (tag === 'Error') {
      const e = v as Error;
      const Ctor = (globalThis as unknown as Record<string, unknown>)[e.name];
      const out = remember(
        typeof Ctor === 'function' && /Error$/.test(e.name)
          ? new (Ctor as ErrorConstructor)(e.message)
          : new Error(e.message),
      );
      if (typeof e.stack === 'string') out.stack = e.stack;
      if ('cause' in e) (out as { cause?: unknown }).cause = clone(e.cause);
      return out;
    }
    if (Array.isArray(v)) {
      const out = remember(new Array<unknown>(v.length));
      for (const key of Object.keys(v)) (out as unknown as Record<string, unknown>)[key] = clone((v as unknown as Record<string, unknown>)[key]);
      return out;
    }
    if (tag === 'Object' || tag === 'Arguments') {
      const out = remember({} as Record<string, unknown>);
      for (const key of Object.keys(v)) out[key] = clone((v as Record<string, unknown>)[key]);
      return out;
    }
    // Blob, File, ImageBitmap, MessagePort and other host objects: immutable or
    // only ever transferred by pdf.js, so pass the reference through.
    return remember(v);
  };
  return clone(value);
});

/*
  Async iteration of a ReadableStream, as specified: each next() reads one
  chunk; the lock is released when the stream ends or errors; an early exit
  (break / return) cancels the stream unless preventCancel is set.
*/
if (typeof ReadableStream === 'function') {
  const proto = ReadableStream.prototype as unknown as Record<PropertyKey, unknown>;
  install(proto, 'values', function values(this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    const preventCancel = Boolean(options?.preventCancel);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      reader.releaseLock();
    };
    return {
      async next() {
        if (finished) return { done: true, value: undefined };
        try {
          const result = await reader.read();
          if (result.done) finish();
          return result;
        } catch (error) {
          finish();
          throw error;
        }
      },
      async return(value?: unknown) {
        if (!finished) {
          if (preventCancel) {
            finish();
          } else {
            const cancelled = reader.cancel(value);
            finish();
            await cancelled;
          }
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  });
  install(proto, Symbol.asyncIterator, proto.values as AnyFn);
}

function bytes(this: { arrayBuffer(): Promise<ArrayBuffer> }) {
  return this.arrayBuffer().then(buffer => new Uint8Array(buffer));
}
if (typeof Response === 'function') install(Response.prototype, 'bytes', bytes);
if (typeof Blob === 'function') install(Blob.prototype, 'bytes', bytes);
