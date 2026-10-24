import { describe, expect, it, vi } from 'vitest';
import { closeTopOverlay, registerOverlay } from './overlayStack';

describe('overlayStack (review F067)', () => {
  it('closes nothing, and says so, when no sheet is open', () => {
    expect(closeTopOverlay()).toBe(false);
  });

  it('closes only the top sheet, then the next one on the next press', () => {
    const bottom = vi.fn();
    const top = vi.fn();
    const offBottom = registerOverlay(bottom);
    const offTop = registerOverlay(top);
    expect(closeTopOverlay()).toBe(true);
    expect(top).toHaveBeenCalledOnce();
    expect(bottom).not.toHaveBeenCalled();
    offTop();
    expect(closeTopOverlay()).toBe(true);
    expect(bottom).toHaveBeenCalledOnce();
    offBottom();
    expect(closeTopOverlay()).toBe(false);
  });

  it('unregistering twice, or out of order, removes only its own entry', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = registerOverlay(a);
    const offB = registerOverlay(b);
    offA();
    offA();
    expect(closeTopOverlay()).toBe(true);
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    offB();
  });
});
