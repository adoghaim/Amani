/**
 * Account deletion's storage step (BS1: review F036): remove every object under
 * the user's `lab-files` prefix, and prove the prefix is empty before the auth
 * identity is deleted.
 *
 * It used to be one `list(userId, { limit: 1000 })` call: anything past the
 * first page outlived the account, and once auth is gone nobody can trigger the
 * cleanup again. Now it pages with an offset until a short page comes back,
 * walks into every folder the same way (RV-R3: a `<uid>/x/y.pdf` written by
 * direct API use is listed under a folder entry, which removing `<uid>/x`
 * never touches, so every retry used to refuse), removes everything it listed,
 * then walks the tree once more and throws `StorageNotEmptyError` while any
 * object remains, so deleteUserAccount stops before `deleteAuthUser` and the
 * user can retry.
 *
 * The whole tree is listed before anything is removed, so removal never shifts
 * the offsets being read. Pure: the handler supplies the Storage I/O.
 */

/** Objects per list page and per remove call. */
export const STORAGE_LIST_PAGE_SIZE = 1000;
/** A page count no real account reaches, over the whole tree; a backend that never returns a short page stops here. */
export const STORAGE_MAX_LIST_PAGES = 1000;
/** Folder levels walked below the prefix. The app writes only `<uid>/<file>`; a deeper tree refuses, it is not skipped. */
export const STORAGE_MAX_FOLDER_DEPTH = 32;

export interface StorageObjectsPort {
  /**
   * One page of the entries directly under `prefix`. A folder is an entry whose
   * `id` is null, as Supabase Storage lists one. MUST throw on failure.
   */
  list(prefix: string, page: { limit: number; offset: number }): Promise<ReadonlyArray<{ name: string; id?: string | null }>>;
  /** Remove these object paths. MUST throw on failure. */
  remove(paths: string[]): Promise<void>;
}

/** Objects survived removal. Carries a count only, never a path (paths start with the user id). */
export class StorageNotEmptyError extends Error {
  readonly remaining: number;
  constructor(remaining: number) {
    super(`Storage still holds ${remaining} object(s) under the account prefix after removal; the account was not deleted.`);
    this.name = "StorageNotEmptyError";
    this.remaining = remaining;
  }
}

interface ListLimits {
  pageSize: number;
  maxPages: number;
  maxDepth: number;
}

/** Every object path under `userId/`, inside folders too. Past either bound it throws, and nothing is removed. */
async function listObjectTree(port: StorageObjectsPort, userId: string, limits: ListLimits): Promise<string[]> {
  const paths: string[] = [];
  let pagesListed = 0;

  async function walk(prefix: string, depth: number): Promise<void> {
    const folders: string[] = [];
    for (let pageIndex = 0; ; pageIndex++) {
      if (pagesListed >= limits.maxPages) {
        throw new Error(`Storage list did not end after more than ${limits.maxPages} pages; the account was not deleted.`);
      }
      pagesListed++;
      const page = await port.list(prefix, { limit: limits.pageSize, offset: pageIndex * limits.pageSize });
      for (const entry of page) {
        if (entry.id === null) folders.push(`${prefix}/${entry.name}`);
        else paths.push(`${prefix}/${entry.name}`);
      }
      if (page.length < limits.pageSize) break;
    }
    for (const folder of folders) {
      if (depth >= limits.maxDepth) {
        throw new Error(`Storage folders nest more than ${limits.maxDepth} levels under the account prefix; the account was not deleted.`);
      }
      await walk(folder, depth + 1);
    }
  }

  await walk(userId, 0);
  return paths;
}

export async function deleteAllStorageObjects(
  port: StorageObjectsPort,
  userId: string,
  options: { pageSize?: number; maxPages?: number; maxDepth?: number } = {},
): Promise<void> {
  const limits: ListLimits = {
    pageSize: options.pageSize ?? STORAGE_LIST_PAGE_SIZE,
    maxPages: options.maxPages ?? STORAGE_MAX_LIST_PAGES,
    maxDepth: options.maxDepth ?? STORAGE_MAX_FOLDER_DEPTH,
  };

  const paths = await listObjectTree(port, userId, limits);

  for (let start = 0; start < paths.length; start += limits.pageSize) {
    await port.remove(paths.slice(start, start + limits.pageSize));
  }

  const remaining = await listObjectTree(port, userId, limits);
  if (remaining.length > 0) throw new StorageNotEmptyError(remaining.length);
}
