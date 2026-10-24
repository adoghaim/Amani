import { describe, expect, it, vi } from 'vitest';
import {
  deleteAllStorageObjects,
  STORAGE_LIST_PAGE_SIZE,
  STORAGE_MAX_FOLDER_DEPTH,
  StorageNotEmptyError,
  type StorageObjectsPort,
} from './account-deletion-storage.ts';

/**
 * BS1 / review F036: a lab-files prefix fake that pages by offset, like Supabase Storage.
 * RV-R3: and lists one level at a time like it, a folder as one entry with a null id, before the objects.
 */
function fakeBucket(names: string[], opts: { sticky?: string[]; ignoreOffset?: boolean } = {}) {
  const objects = new Set(names.map((n) => `u/${n}`));
  const lists: Array<{ limit: number; offset: number }> = [];
  const removes: string[][] = [];
  const events: string[] = [];
  const port: StorageObjectsPort = {
    list: vi.fn(async (prefix: string, page: { limit: number; offset: number }) => {
      lists.push(page);
      events.push(`list:${prefix}@${page.offset}`);
      const under = [...objects].filter((p) => p.startsWith(`${prefix}/`)).map((p) => p.slice(prefix.length + 1));
      const folders = [...new Set(under.filter((n) => n.includes('/')).map((n) => n.split('/')[0]!))]
        .sort((a, b) => a.localeCompare(b)).map((name) => ({ name, id: null }));
      const files = under.filter((n) => !n.includes('/'))
        .sort((a, b) => a.localeCompare(b)).map((name) => ({ name, id: `object:${name}` }));
      const all = [...folders, ...files];
      const offset = opts.ignoreOffset ? 0 : page.offset;
      return all.slice(offset, offset + page.limit);
    }),
    remove: vi.fn(async (paths: string[]) => {
      removes.push(paths);
      events.push(`remove:${paths.length}`);
      for (const p of paths) if (!opts.sticky?.includes(p)) objects.delete(p);
    }),
  };
  return { port, objects, lists, removes, events };
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

describe('deleteAllStorageObjects walks folders (RV-R3 AC2, RES1 168-4)', () => {
  it('removes an object inside a folder as well as one at the top: the whole tree is listed, removed, then walked again', async () => {
    const bucket = fakeBucket(['a.pdf', 'x/y.pdf']);

    await deleteAllStorageObjects(bucket.port, 'u');

    expect(bucket.objects.size).toBe(0);
    expect(bucket.removes).toEqual([['u/a.pdf', 'u/x/y.pdf']]);
    expect(bucket.events).toEqual(['list:u@0', 'list:u/x@0', 'remove:2', 'list:u@0']);
  });

  it('still refuses when remove silently skips an object inside a folder, naming the count and no path', async () => {
    const bucket = fakeBucket(['a.pdf', 'x/y.pdf'], { sticky: ['u/x/y.pdf'] });

    const failure = deleteAllStorageObjects(bucket.port, 'u');

    await expect(failure).rejects.toBeInstanceOf(StorageNotEmptyError);
    await expect(failure).rejects.toMatchObject({ remaining: 1 });
    await expect(failure).rejects.not.toThrow(/u\//);
  });

  it('pages inside every folder and walks nested folders before removing anything', async () => {
    const bucket = fakeBucket(['5.pdf', 'x/1.pdf', 'x/2.pdf', 'x/3.pdf', 'x/y/z/4.pdf']);

    await deleteAllStorageObjects(bucket.port, 'u', { pageSize: 2 });

    expect(bucket.objects.size).toBe(0);
    expect(bucket.events).toEqual([
      'list:u@0', 'list:u@2',
      'list:u/x@0', 'list:u/x@2', 'list:u/x@4',
      'list:u/x/y@0', 'list:u/x/y/z@0',
      'remove:2', 'remove:2', 'remove:1',
      'list:u@0',
    ]);
  });

  it(`by default walks ${STORAGE_MAX_FOLDER_DEPTH} folder levels and refuses, removing nothing, at one more`, async () => {
    const nested = (levels: number) => `${Array.from({ length: levels }, (_, i) => `d${i}`).join('/')}/f.pdf`;

    const deepest = fakeBucket([nested(STORAGE_MAX_FOLDER_DEPTH)]);
    await deleteAllStorageObjects(deepest.port, 'u');
    expect(deepest.objects.size).toBe(0);

    const tooDeep = fakeBucket([nested(STORAGE_MAX_FOLDER_DEPTH + 1)]);
    await expect(deleteAllStorageObjects(tooDeep.port, 'u')).rejects.toThrow(`nest more than ${STORAGE_MAX_FOLDER_DEPTH} levels`);
    expect(tooDeep.port.remove).not.toHaveBeenCalled();
  });

  it('counts the pages of every folder against one bound', async () => {
    const bucket = fakeBucket(['f1/1.pdf', 'f2/2.pdf', 'f3/3.pdf']);

    await expect(deleteAllStorageObjects(bucket.port, 'u', { maxPages: 3 })).rejects.toThrow(/more than 3 pages/);
    expect(bucket.events).toEqual(['list:u@0', 'list:u/f1@0', 'list:u/f2@0']);
    expect(bucket.port.remove).not.toHaveBeenCalled();
  });
});
