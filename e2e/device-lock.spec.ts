import { test, expect } from './fixtures';

// PK-DEVICE-01: the enabled flag must not change browser auth or load plugins.
test.use({ runtimeConfigReply: {
  status: 200,
  body: [{ key: 'features', value: { biometric_lock: true } }],
} });

test('public web stays unlocked with the flag on', async ({ page, runtimeConfigReads }) => {
  const plugins: string[] = [];
  page.on('request', request => { if (request.url().includes('aparajita')) plugins.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Your labs, read against your cycle.' })).toBeVisible();
  await expect.poll(() => runtimeConfigReads.length).toBe(1);
  await expect(page.getByRole('heading', { name: 'Amani is locked' })).toHaveCount(0);
  expect(plugins).toEqual([]);
});

test.describe('signed-in web preserves the seeded session', () => {
  test.use({ authenticated: true });
  for (const storedLock of [false, true]) {
    test(`load and reload with stored lock=${storedLock}`, async ({ page, storageState, runtimeConfigReads }) => {
      const plugins: string[] = [];
      page.on('request', request => { if (request.url().includes('aparajita')) plugins.push(request.url()); });
      const lockValue = JSON.stringify({ enabled: true, relockAfter: 'immediately' });
      if (storedLock) {
        await page.addInitScript(value => localStorage.setItem('amani.device-lock.v1', value), lockValue);
      }
      if (!storageState || typeof storageState === 'string') throw new Error('Expected synthetic storageState fixture');
      const seeded = storageState.origins.flatMap(entry => entry.localStorage)
        .find(entry => entry.name === 'sb-amani-e2e-auth-token');
      if (!seeded) throw new Error('Missing synthetic session');
      const expectedToken = (JSON.parse(seeded.value) as { access_token: string }).access_token;
      await page.goto('/app/reports');
      for (const reads of [1, 2]) {
        if (reads === 2) await page.reload();
        await expect(page.getByRole('heading', { name: 'Lab panels', exact: true })).toBeVisible();
        await expect.poll(() => runtimeConfigReads.length).toBe(reads);
        await expect(page.getByRole('heading', { name: 'Amani is locked' })).toHaveCount(0);
        const stored = await page.evaluate(() => ({
          session: localStorage.getItem('sb-amani-e2e-auth-token'),
          marker: localStorage.getItem('amani.install-marker.v1'),
          lock: localStorage.getItem('amani.device-lock.v1'),
        }));
        expect(JSON.parse(stored.session ?? '{}').access_token).toBe(expectedToken);
        expect(stored.marker).toBeNull();
        expect(stored.lock).toBe(storedLock ? lockValue : null);
        expect(plugins).toEqual([]);
      }
    });
  }
});
