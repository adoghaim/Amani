import { describe, expect, it, vi } from 'vitest';
import {
  deleteAllStorageObjects,
  STORAGE_LIST_PAGE_SIZE,
  StorageNotEmptyError,
  type StorageObjectsPort,
} from './account-deletion-storage.ts';

/** BS1 / review F036: a lab-files prefix fake that pages by offset, like Supabase Storage. */
function fakeBucket(names: string[], opts: { sticky?: string[]; ignoreOffset?: boolean } = {}) {
  const objects = new Set(names.map((n) => `u/${n}`));
  const lists: Array<{ limit: number; offset: number }> = [];
  const removes: string[][] = [];
  const port: StorageObjectsPort = {
    list: vi.fn(async (prefix: string, page: { limit: number; offset: number }) => {
      lists.push(page);
      const all = [...objects].filter((p) => p.startsWith(`${prefix}/`)).map((p) => ({ name: p.slice(prefix.length + 1) })).sort((a, b) => a.name.localeCompare(b.name));
      const offset = opts.ignoreOffset ? 0 : page.offset;
      return all.slice(offset, offset + page.limit);
    }),
    remove: vi.fn(async (paths: string[]) => {
      removes.push(paths);
      for (const p of paths) if (!opts.sticky?.includes(p)) objects.delete(p);
    }),
  };
  return { port, objects, lists, removes };
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `${String(i).padStart(5, '0')}.pdf`);

describe('deleteAllStorageObjects', () => {
  it('pages with an offset until a short page, removes everything, then lists once more', async () => {
    const bucket = fakeBucket(names(2345));

    await deleteAllStorageObjects(bucket.port, 'u');

    expect(STORAGE_LIST_PAGE_SIZE).toBe(1000);
    expect(bucket.lists).toEqual([
      { limit: 1000, offset: 0 },
      { limit: 1000, offset: 1000 },
      { limit: 1000, offset: 2000 },
      { limit: 1000, offset: 0 },
    ]);
    expect(bucket.removes.map((b) => b.length)).toEqual([1000, 1000, 345]);
    expect(bucket.removes.flat()).toEqual(names(2345).map((n) => `u/${n}`));
    expect(bucket.objects.size).toBe(0);
  });

  it('a prefix of exactly one full page still reads the next (empty) page before stopping', async () => {
    const bucket = fakeBucket(names(4));

    await deleteAllStorageObjects(bucket.port, 'u', { pageSize: 2 });

    expect(bucket.lists.map((l) => l.offset)).toEqual([0, 2, 4, 0]);
    expect(bucket.objects.size).toBe(0);
  });

  it('an empty prefix removes nothing and passes the final check', async () => {
    const bucket = fakeBucket([]);

    await deleteAllStorageObjects(bucket.port, 'u');

    expect(bucket.port.remove).not.toHaveBeenCalled();
    expect(bucket.lists).toEqual([{ limit: 1000, offset: 0 }, { limit: 1000, offset: 0 }]);
  });

  it('refuses when an object is still there after removal, naming the count and no path', async () => {
    const bucket = fakeBucket(names(3), { sticky: ['u/00002.pdf'] });

    const failure = deleteAllStorageObjects(bucket.port, 'u');

    await expect(failure).rejects.toBeInstanceOf(StorageNotEmptyError);
    await expect(failure).rejects.toMatchObject({ remaining: 1 });
    await expect(failure).rejects.not.toThrow(/u\//);
  });

  it('propagates a list failure without removing anything', async () => {
    const bucket = fakeBucket(names(3));
    bucket.port.list = vi.fn(async () => { throw new Error('Storage list failed: timeout'); });

    await expect(deleteAllStorageObjects(bucket.port, 'u')).rejects.toThrow('Storage list failed: timeout');
    expect(bucket.port.remove).not.toHaveBeenCalled();
  });

  it('propagates a remove failure and never reports the prefix empty', async () => {
    const bucket = fakeBucket(names(3));
    bucket.port.remove = vi.fn(async () => { throw new Error('Storage remove failed: 500'); });

    await expect(deleteAllStorageObjects(bucket.port, 'u')).rejects.toThrow('Storage remove failed: 500');
  });

  it('stops instead of looping forever when every page comes back full', async () => {
    const bucket = fakeBucket(names(2), { ignoreOffset: true });

    await expect(deleteAllStorageObjects(bucket.port, 'u', { pageSize: 2, maxPages: 5 })).rejects.toThrow(/more than 5 pages/);
    expect(bucket.lists).toHaveLength(5);
    expect(bucket.port.remove).not.toHaveBeenCalled();
  });
});
