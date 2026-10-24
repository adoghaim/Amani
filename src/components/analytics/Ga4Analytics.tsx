import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isNative } from '../../lib/native'
import {
  ANALYTICS_CONSENT_KEY, type AnalyticsChoice, applyAnalyticsConsent, ga4MeasurementId,
  isMeasurablePath, OPEN_ANALYTICS_CONSENT_EVENT as OPEN_EVENT, readAnalyticsChoice, trackPageView,
} from '../../lib/analytics/ga4'


/**
 * Mounts GA4 + its consent banner. Renders nothing when VITE_GA4_ID is unset,
 * on native, or on non-public routes (the banner is only shown on marketing pages).
 */
export function Ga4Analytics() {
  const location = useLocation()
  const measurementId = ga4MeasurementId()
  const native = safeIsNative()
  const [choice, setChoice] = useState<AnalyticsChoice | null>(() => readAnalyticsChoice())
  const [forcedOpen, setForcedOpen] = useState(false)
  const enabled = Boolean(measurementId) && !native
  const publicPage = isMeasurablePath(location.pathname)

  useEffect(() => {
    if (!enabled) return
    applyAnalyticsConsent(choice, { win: window as never, doc: document, measurementId, native })
  }, [enabled, choice, measurementId, native])

  useEffect(() => {
    if (!enabled) return
    trackPageView(window.location.href, document.title, { win: window as never, measurementId }, choice)
  }, [enabled, choice, measurementId, location.pathname, location.search])

  useEffect(() => {
    const open = () => setForcedOpen(true)
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])

  if (!enabled || !publicPage || (choice !== null && !forcedOpen)) return null

  const decide = (next: AnalyticsChoice) => {
    try { window.localStorage.setItem(ANALYTICS_CONSENT_KEY, next) } catch { /* private mode */ }
    setChoice(next)
    setForcedOpen(false)
  }

  return (
    <div role="dialog" aria-label="Analytics cookies" data-testid="analytics-consent"
      className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-xl rounded-xl border border-theme-border bg-theme-surface p-4 shadow-lg text-sm text-theme-text">
      <p className="mb-3">
        May we use Google Analytics cookies to count visits to our public pages? This is off unless you
        agree, never runs inside your account or reports, and is never used for advertising.{' '}
        <a href="/privacy#analytics" className="underline">Privacy policy</a>
      </p>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => decide('denied')} className="px-3 py-1.5 rounded-lg border border-theme-border">Decline</button>
        <button type="button" onClick={() => decide('granted')} className="px-3 py-1.5 rounded-lg bg-theme-primary text-white">Accept analytics</button>
      </div>
    </div>
  )
}

function safeIsNative(): boolean {
  try { return isNative() } catch { return false }
}
