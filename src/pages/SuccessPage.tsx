/*
  Post-checkout landing page.

  The previous version refetched entitlement exactly once, 2 seconds after
  mount, and unconditionally told the user "You now have access to all premium
  features". Stripe webhooks routinely take longer than that — `stripe-webhook`
  claims an idempotency lease and does real work before the subscription row
  exists — so the sequence a slow webhook produced was:

    pay -> "you now have access" -> tap Continue -> SubscriptionGate runs a LIVE
    server check -> no row yet -> redirected to /pricing

  Being sent back to the paywall seconds after paying is the worst moment to be
  wrong, and there was no second attempt: one setTimeout, no polling.

  So this page now waits for entitlement to actually exist before claiming it,
  and says something honest while it waits.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Loader2, Clock } from 'lucide-react'
import { Button } from '../components/Button'
import { checkSubscriptionLive } from '../utils/subscription'

/** How often to re-ask the server. */
const POLL_INTERVAL_MS = 2000

/**
 * How long to keep asking. Generous, because the failure mode of giving up too
 * early is telling a paying customer their payment did not work.
 */
const POLL_TIMEOUT_MS = 45000

type State = 'confirming' | 'confirmed' | 'slow'

export function SuccessPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>('confirming')
  const cancelled = useRef(false)

  const poll = useCallback(async () => {
    const startedAt = Date.now()

    while (!cancelled.current) {
      /*
        The same live server check SubscriptionGate uses, so this page cannot
        conclude "entitled" while the gate would conclude otherwise. A thrown
        read is treated as not-yet rather than as failure — the webhook may
        still be in flight, and the loop has its own deadline.
      */
      const allowed = await checkSubscriptionLive()
        .then((r) => r.allowed)
        .catch(() => false)

      if (cancelled.current) return
      if (allowed) {
        setState('confirmed')
        return
      }
      if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
        setState('slow')
        return
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
    }
  }, [])

  useEffect(() => {
    cancelled.current = false
    void poll()
    return () => {
      cancelled.current = true
    }
  }, [poll])

  const retry = () => {
    setState('confirming')
    void poll()
  }

  return (
    <div className="min-h-dvh bg-theme-background flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 safe-top safe-bottom">
      <div className="max-w-md w-full text-center">
        <div className="bg-theme-surface rounded-lg shadow-lg p-8 border border-theme-border">
          {state === 'confirming' && (
            <>
              <div className="flex justify-center mb-6">
                <Loader2 className="h-16 w-16 text-theme-primary animate-spin" />
              </div>
              <h1 className="text-2xl text-theme-text mb-4">Confirming your subscription</h1>
              <p className="text-theme-muted-text mb-8">
                Your payment went through. We&rsquo;re just waiting for it to be confirmed —
                this usually takes a few seconds.
              </p>
            </>
          )}

          {state === 'confirmed' && (
            <>
              <div className="flex justify-center mb-6">
                <CheckCircle className="h-16 w-16 text-theme-flag-ok" />
              </div>
              <h1 className="text-2xl text-theme-text mb-4">You&rsquo;re all set</h1>
              <p className="text-theme-muted-text mb-8">
                Thank you for subscribing. Every Amani feature is unlocked on your account.
              </p>
              {/*
                /app, not /. The old CTA said "Continue to Dashboard" and
                navigated to the marketing landing page.
              */}
              <Button onClick={() => navigate('/app', { replace: true })} className="w-full">
                Continue to Dashboard
              </Button>
            </>
          )}

          {state === 'slow' && (
            <>
              <div className="flex justify-center mb-6">
                <Clock className="h-16 w-16 text-theme-flag-watch" />
              </div>
              <h1 className="text-2xl text-theme-text mb-4">Payment received</h1>
              <p className="text-theme-muted-text mb-6">
                Your payment went through, but activation is taking longer than usual. Nothing
                is lost — it normally completes on its own within a few minutes.
              </p>
              <div className="space-y-3">
                <Button onClick={retry} className="w-full">
                  Check again
                </Button>
                {/*
                  Deliberately /app/billing rather than /app: if activation is
                  genuinely stuck, billing is where they can see their status
                  and is where an existing customer belongs.
                */}
                <Button
                  variant="outline"
                  onClick={() => navigate('/app/billing', { replace: true })}
                  className="w-full"
                >
                  Go to billing
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
