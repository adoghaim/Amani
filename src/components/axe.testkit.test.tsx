// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { axeViolations } from './axe.testkit';

// Negative control: the helper the component tests rely on does report a
// violation, so their empty lists mean axe ran and found nothing.
it('reports what axe finds, by rule and target', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const app = document.createElement('div');
  document.body.append(app);
  const root = createRoot(app);
  try {
    await act(async () => root.render(<>
      <button id="unnamed" type="button" />
      <img id="no-alt" src="data:," />
      <div role="checkbox" id="unlabelled-checkbox" aria-checked="false" tabIndex={0} />
    </>));
    const found = await axeViolations(app);
    expect(found).toContain('button-name: #unnamed');
    expect(found).toContain('image-alt: #no-alt');
    expect(found).toContain('aria-toggle-field-name: #unlabelled-checkbox');
  } finally {
    await act(async () => root.unmount());
    app.remove();
    vi.unstubAllGlobals();
  }
});
