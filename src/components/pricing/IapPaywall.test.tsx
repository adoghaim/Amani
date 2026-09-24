import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { IapPaywall } from './IapPaywall'

const scenario = vi.hoisted(() => ({ phase: 'unavailable' }))

// Server rendering does not run effects. Supply the settled load state so this
// test exercises the fallback markup without changing production initialization.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(
      initial && typeof initial === 'object' && 'phase' in initial
        ? { phase: scenario.phase }
        : initial,
    ),
  }
})
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user' } }),
}))
vi.mock('../../lib/iap', () => ({
  getIapOfferings: vi.fn(),
  initIap: vi.fn(),
  isIapConfigured: vi.fn(),
  restoreIapPurchases: vi.fn(),
  syncIapEntitlement: vi.fn(),
}))
vi.mock('./IapPricingCard', () => ({ IapPricingCard: () => null }))

afterEach(() => {
  scenario.phase = 'unavailable'
  vi.clearAllMocks()
})

function renderPaywall() {
  return renderToStaticMarkup(
    <StaticRouter location="/pricing"><IapPaywall onEntitled={vi.fn()} /></StaticRouter>,
  )
}

describe('IapPaywall unavailable plans', () => {
  it('offers in-app support without directing users to an external purchase', () => {
    const html = renderPaywall()
    expect(html).toContain('Plans are temporarily unavailable. Please try again later or')
    expect(html).toContain('href="/contact"')
    expect(html).toContain('contact support')
    expect(html).not.toContain('amanibiometrics.com')
    expect(html).not.toMatch(/subscribe at|href="https?:\/\//)
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Restore Purchases<\/button>/)
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
  })

  it('keeps the loading state separate from the unavailable message', () => {
    scenario.phase = 'loading'
    const html = renderPaywall()
    expect(html).toContain('Loading plans…')
    expect(html).not.toContain('Plans are temporarily unavailable.')
    expect(html).toContain('Restore Purchases')
  })
})
