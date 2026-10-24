import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyAnalyticsConsent, ga4MeasurementId, isMeasurablePath, looksLikeAuthUrl,
  readAnalyticsChoice, resetGa4ForTests, sanitizePath, sanitizeUrl, trackPageView,
} from './ga4'

const ID = 'G-1SYG7NWRVK'
function fakeEnv(overrides: Partial<{ measurementId: string | null; native: boolean }> = {}) {
  const appended: { src: string; async: boolean }[] = []
  const win: Record<string, unknown> = {}
  const doc = {
    createElement: () => ({ src: '', async: false }),
    head: { appendChild: (el: { src: string; async: boolean }) => { appended.push(el); return el } },
  }
  return { win, doc: doc as never, appended, measurementId: ID, native: false, ...overrides }
}
const calls = (win: Record<string, unknown>) => ((win.dataLayer as IArguments[]) ?? []).map(a => Array.from(a))

describe('sanitizer', () => {
  it('masks ids, uuids, tokens and emails in paths', () => {
    expect(sanitizePath('/app/reports/123')).toBe('/app/reports/:id')
    expect(sanitizePath('/app/reports/3f2b1c4e-1a2b-4c3d-8e9f-0123456789ab')).toBe('/app/reports/:id')
    expect(sanitizePath('/go/eyJhbGciOiJIUzI1NiJ9abc123')).toBe('/go/:id')
    expect(sanitizePath('/u/jane%40example.com')).toBe('/u/:id')
    expect(sanitizePath('/pricing/')).toBe('/pricing')
    expect(sanitizePath('/privacy')).toBe('/privacy')
  })
  it('keeps only utm_* params and drops fragments', () => {
    const r = sanitizeUrl('https://amanibiometrics.com/pricing?utm_source=ig&email=a@b.c&ref=x&UTM_Campaign=fall#access_token=abc')
    expect(r.page_location).toBe('https://amanibiometrics.com/pricing?utm_source=ig&utm_campaign=fall')
    expect(r.page_path).toBe('/pricing')
  })
  it('drops utm values containing an email', () => {
    expect(sanitizeUrl('https://x.com/?utm_term=a@b.com').page_location).toBe('https://x.com/')
  })
  it('detects auth/callback URLs', () => {
    expect(looksLikeAuthUrl('https://x.com/#access_token=a&type=recovery')).toBe(true)
    expect(looksLikeAuthUrl('https://x.com/?code=abc')).toBe(true)
    expect(looksLikeAuthUrl('https://x.com/success?session_id=cs_1')).toBe(true)
    expect(looksLikeAuthUrl('https://x.com/?utm_source=a')).toBe(false)
  })
  it('only public marketing paths are measurable', () => {
    for (const p of ['/', '/pricing', '/privacy/', '/terms', '/contact']) expect(isMeasurablePath(p)).toBe(true)
    for (const p of ['/app', '/app/reports/1', '/login', '/signup', '/reset-password', '/success', '/onboarding', '/go/abc', '/app/pricing'])
      expect(isMeasurablePath(p)).toBe(false)
  })
})

describe('measurement id', () => {
  it('is off unless a valid id is set', () => {
    expect(ga4MeasurementId(undefined)).toBeNull()
    expect(ga4MeasurementId('')).toBeNull()
    expect(ga4MeasurementId('UA-1')).toBeNull()
    expect(ga4MeasurementId(` ${ID} `)).toBe(ID)
  })
})

describe('consent gating', () => {
  beforeEach(() => resetGa4ForTests())

  it('reads stored choice defensively', () => {
    expect(readAnalyticsChoice({ getItem: () => 'granted' })).toBe('granted')
    expect(readAnalyticsChoice({ getItem: () => 'yes' })).toBeNull()
    expect(readAnalyticsChoice({ getItem: () => { throw new Error('x') } })).toBeNull()
  })

  it('loads nothing without consent, when denied, without id, or on native', () => {
    for (const [choice, o] of [[null, {}], ['denied', {}], ['granted', { measurementId: null }], ['granted', { native: true }]] as const) {
      resetGa4ForTests()
      const env = fakeEnv(o)
      expect(applyAnalyticsConsent(choice, env)).toBe(false)
      expect(env.appended).toHaveLength(0)
      expect(env.win.gtag).toBeUndefined()
      expect(trackPageView('https://x.com/', 't', env, choice)).toBe(false)
    }
  })

  it('on grant: consent defaults denied, ads always denied, signals off, no auto page_view', () => {
    const env = fakeEnv()
    expect(applyAnalyticsConsent('granted', env)).toBe(true)
    expect(env.appended[0]!.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${ID}`)
    const c = calls(env.win)
    expect(c[0]!).toEqual(['consent', 'default', expect.objectContaining({
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' })])
    const update = c.find(x => x[0] === 'consent' && x[1] === 'update')!
    expect(update[2]).toEqual({ analytics_storage: 'granted' })
    expect(c.find(x => x[0] === 'config')![2]).toEqual({
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false })
    expect(JSON.stringify(c)).not.toMatch(/"ad_(storage|user_data|personalization)":"granted"/)
  })

  it('sends sanitized page_view only on public non-auth URLs', () => {
    const env = fakeEnv()
    applyAnalyticsConsent('granted', env)
    expect(trackPageView('https://a.com/pricing?utm_source=x&foo=1#h', 'Pricing', env, 'granted')).toBe(true)
    expect(trackPageView('https://a.com/app/reports/42', 'R', env, 'granted')).toBe(false)
    expect(trackPageView('https://a.com/#access_token=t', 'H', env, 'granted')).toBe(false)
    expect(trackPageView('https://a.com/pricing', 'P', env, 'denied')).toBe(false)
    const pv = calls(env.win).filter(x => x[0] === 'event')
    expect(pv).toHaveLength(1)
    expect(pv[0]![2]).toMatchObject({ page_location: 'https://a.com/pricing?utm_source=x', page_path: '/pricing' })
  })

  it('withdrawal revokes analytics_storage and disables the tag', () => {
    const env = fakeEnv()
    applyAnalyticsConsent('granted', env)
    expect(applyAnalyticsConsent('denied', env)).toBe(false)
    expect(calls(env.win).slice(-1)[0]).toEqual(['consent', 'update', { analytics_storage: 'denied' }])
    expect(env.win[`ga-disable-${ID}`]).toBe(true)
    expect(trackPageView('https://a.com/', 'H', env, 'denied')).toBe(false)
  })
})
