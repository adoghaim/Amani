// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/native', () => ({ isNative: () => false }))

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return { get length() { return m.size }, clear: () => m.clear(), getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null, removeItem: k => { m.delete(k) }, setItem: (k, v) => { m.set(k, String(v)) } }
}
let root: Root; let host: HTMLDivElement
async function mount(path: string) {
  const { Ga4Analytics } = await import('./Ga4Analytics')
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MemoryRouter initialEntries={[path]}><Ga4Analytics /></MemoryRouter>) })
}
const gtagScripts = () => document.querySelectorAll('script[src*="googletagmanager.com"]').length

describe('Ga4Analytics', () => {
  beforeEach(() => { vi.resetModules(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true }); document.head.innerHTML = ''; delete (window as never as Record<string, unknown>).gtag })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it('renders nothing and loads nothing when VITE_GA4_ID is unset', async () => {
    vi.stubEnv('VITE_GA4_ID', '')
    await mount('/')
    expect(host.querySelector('[data-testid="analytics-consent"]')).toBeNull()
    expect(gtagScripts()).toBe(0)
  })

  it('shows the banner on public pages but loads gtag only after Accept', async () => {
    vi.stubEnv('VITE_GA4_ID', 'G-1SYG7NWRVK')
    await mount('/pricing')
    expect(host.querySelector('[data-testid="analytics-consent"]')).not.toBeNull()
    expect(gtagScripts()).toBe(0)
    const accept = [...host.querySelectorAll('button')].find(b => b.textContent?.includes('Accept'))!
    await act(async () => { accept.click() })
    expect(localStorage.getItem('amani.analytics_consent')).toBe('granted')
    expect(gtagScripts()).toBe(1)
    expect(host.querySelector('[data-testid="analytics-consent"]')).toBeNull()
  })

  it('Decline loads nothing', async () => {
    vi.stubEnv('VITE_GA4_ID', 'G-1SYG7NWRVK')
    await mount('/')
    const decline = [...host.querySelectorAll('button')].find(b => b.textContent === 'Decline')!
    await act(async () => { decline.click() })
    expect(localStorage.getItem('amani.analytics_consent')).toBe('denied')
    expect(gtagScripts()).toBe(0)
  })

  it('never shows the banner inside the app', async () => {
    vi.stubEnv('VITE_GA4_ID', 'G-1SYG7NWRVK')
    await mount('/app/reports/123')
    expect(host.querySelector('[data-testid="analytics-consent"]')).toBeNull()
    expect(gtagScripts()).toBe(0)
  })
})
