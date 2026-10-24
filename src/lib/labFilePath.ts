// The upload's storage key comes from the type NewReport validated, never from
// the file name (RV-DB4, review F032 follow-up). A name is free text: with no
// dot, the whole name went into the key, and a '?' in it made DB3's file_url
// guard (20261023101000) refuse the report after the upload had succeeded.
const EXTENSION_BY_TYPE: ReadonlyMap<string, string> = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);

/** `<userId>/<now>.<ext>`: `pdf`, `jpg` or `png` for the three accepted types, `bin` for anything else. */
export function labFileStoragePath(userId: string, mimeType: string, now: number): string {
  return `${userId}/${now}.${EXTENSION_BY_TYPE.get(mimeType) ?? 'bin'}`;
}
