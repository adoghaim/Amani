import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { IapPaywall } from './IapPaywall'

const scenario = vi.hoisted(() => ({
  phase: 'unavailable',
  products: [] as Array<{ productId: string }>,
  source: 'none',
}))

// Server rendering does not run effects. Supply the settled load state so this
// test exercises the fallback markup without changing production initialization.
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useState: (initial: unknown) => actual.useState(
      initial && typeof initial === 'object' && 'phase' in initial
        ? { phase: scenario.phase, products: scenario.products }
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
vi.mock('./IapPricingCard', () => ({
  IapPricingCard: ({ product }: { product: { productId: string } }) => <div data-store-card={product.productId} />,
}))
vi.mock('../../hooks/useSubscription', () => ({ useSubscription: () => ({ source: scenario.source }) }))

afterEach(() => {
  scenario.phase = 'unavailable'
  scenario.products = []
  scenario.source = 'none'
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

describe('IapPaywall with a paid plan (BS2, review F040)', () => {
  const ready = () => {
    scenario.phase = 'ready'
    scenario.products = [{ productId: 'com.amani.health.premium.yearly' }, { productId: 'com.amani.health.premium.monthly' }]
  }

  it.each(['ios', 'android', 'stripe'])('a %s subscriber sees no store plan to buy, and keeps Restore Purchases', (source) => {
    ready()
    scenario.source = source
    const html = renderPaywall()
    expect(html).not.toContain('data-store-card')
    expect(html).toContain('You already have an active plan.')
    expect(html).toContain('Manage your plan')
    expect(html).toContain('Restore Purchases')
    expect(html).toContain('href="/terms"')
  })

  it.each(['none', 'trial', 'complimentary'])('%s still sees both store plans', (source) => {
    ready()
    scenario.source = source
    const html = renderPaywall()
    expect(html).toContain('data-store-card="com.amani.health.premium.yearly"')
    expect(html).toContain('data-store-card="com.amani.health.premium.monthly"')
    expect(html).not.toContain('You already have an active plan.')
  })
})
