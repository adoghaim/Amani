/**
 * Account deletion's storage step (BS1: review F036): remove every object under
 * the user's `lab-files` prefix, and prove the prefix is empty before the auth
 * identity is deleted.
 *
 * It used to be one `list(userId, { limit: 1000 })` call: anything past the
 * first page outlived the account, and once auth is gone nobody can trigger the
 * cleanup again. Now it pages with an offset until a short page comes back,
 * removes everything it listed, then lists once more and throws
 * `StorageNotEmptyError` while any object remains, so deleteUserAccount stops
 * before `deleteAuthUser` and the user can retry.
 *
 * Every page is listed before anything is removed, so removal never shifts the
 * offsets being read. Pure: the handler supplies the Storage I/O.
 */

/** Objects per list page and per remove call. */
export const STORAGE_LIST_PAGE_SIZE = 1000;
/** A page count no real account reaches; a backend that never returns a short page stops here. */
export const STORAGE_MAX_LIST_PAGES = 1000;

export interface StorageObjectsPort {
  /** One page of the objects directly under `prefix`. MUST throw on failure. */
  list(prefix: string, page: { limit: number; offset: number }): Promise<ReadonlyArray<{ name: string }>>;
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

export async function deleteAllStorageObjects(
  port: StorageObjectsPort,
  userId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<void> {
  const pageSize = options.pageSize ?? STORAGE_LIST_PAGE_SIZE;
  const maxPages = options.maxPages ?? STORAGE_MAX_LIST_PAGES;

  const paths: string[] = [];
  for (let pageIndex = 0; ; pageIndex++) {
    if (pageIndex >= maxPages) {
      throw new Error(`Storage list did not end after more than ${maxPages} pages; the account was not deleted.`);
    }
    const page = await port.list(userId, { limit: pageSize, offset: pageIndex * pageSize });
    for (const object of page) paths.push(`${userId}/${object.name}`);
    if (page.length < pageSize) break;
  }

  for (let start = 0; start < paths.length; start += pageSize) {
    await port.remove(paths.slice(start, start + pageSize));
  }

  const remaining = await port.list(userId, { limit: pageSize, offset: 0 });
  if (remaining.length > 0) throw new StorageNotEmptyError(remaining.length);
}
