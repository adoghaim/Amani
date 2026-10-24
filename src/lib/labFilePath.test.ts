import { describe, expect, it } from 'vitest';
import { labFileStoragePath } from './labFilePath';

// RV-DB4 (DB4-1). Synthetic user id and clock only.
const UID = '00000000-0000-4000-8000-0000000db400';
const NOW = 1761300000000;
// DB3's guard (20261023101000) accepts a path in her own folder with no empty,
// '.' or '..' segment and none of '%', '?', '#', a backslash or a control
// character; this shape satisfies it and stays inside Storage's key alphabet.
const UPLOAD_PATH = new RegExp(`^${UID}/\\d+\\.(pdf|jpg|png)$`);

describe('labFileStoragePath', () => {
  it.each([
    ['application/pdf', 'pdf'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
  ])('%s is stored as .%s, at the given time, in her own folder', (type, ext) => {
    const path = labFileStoragePath(UID, type, NOW);
    expect(path).toBe(`${UID}/${NOW}.${ext}`);
    expect(path).toMatch(UPLOAD_PATH);
  });

  it.each(['', 'text/plain'])('%j has no extension of its own: .bin', (type) => {
    expect(labFileStoragePath(UID, type, NOW)).toBe(`${UID}/${NOW}.bin`);
  });

  it.each([
    'IMAGE/PNG', 'image/png ', 'image/png; charset=binary', 'image/jpg', 'application/x-pdf',
    'constructor', 'toString', '__proto__',
  ])('only an exact type matches: %j is .bin', (type) => {
    expect(labFileStoragePath(UID, type, NOW)).toBe(`${UID}/${NOW}.bin`);
  });

  it('takes the time it is given', () => {
    expect(labFileStoragePath(UID, 'image/png', 0)).toBe(`${UID}/0.png`);
    expect(labFileStoragePath(UID, 'image/png', NOW + 1)).toBe(`${UID}/${NOW + 1}.png`);
  });
});
