import { useState } from 'react'
import { Button } from '../Button'
import { StripeProduct, formatPrice } from '../../stripe-config'
import { supabase } from '../../lib/supabase'
import { publicUrl } from '../../lib/appUrl';
import { openExternalUrl } from '../../lib/native'
import { errorMessage } from '../../lib/errors'
import { clientFreemiumActive } from '../../lib/tier'
import { firstPartyEvents } from '../../lib/firstPartyEventsClient'
import { planCheckoutCta } from '../../lib/planCta'
import { readSavedPromoCode } from '../../lib/savedPromoCode'

interface PricingCardProps {
  product: StripeProduct
  isPopular?: boolean
}

export function PricingCard({ product, isPopular = false }: PricingCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubscribe = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        // Internal route — use location for SPA navigation (no external browser needed)
        window.location.href = `/signup?redirect=${encodeURIComponent('/pricing')}`
        return
      }

      // PK-EXP5 funnel step: not awaited, so checkout never waits on it.
      void firstPartyEvents.track('checkout_started', { platform: 'web' })

      const promoCode = readSavedPromoCode()
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stripe-checkout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          price_id: product.priceId,
          success_url: publicUrl('/success'),
          cancel_url: publicUrl('/app/pricing'),
          mode: product.mode,
          // Her saved creator/partner code, if any (D29). The server decides
          // whether it applies; nothing here promises a discount.
          ...(promoCode ? { promo_code: promoCode } : {}),
        })
      })

      const data = await response.json()

      if (data.url) {
        await openExternalUrl(data.url)
      } else if (typeof data.message === 'string') {
        setError(data.message)
      } else {
        setError(`Error (${response.status}): ${data.error || 'Unknown error'}`)
      }
    } catch (err: unknown) {
      setError(`Connection error: ${errorMessage(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const fmt = (price: number) => formatPrice(price, product.currency);

  const intervalLabel = product.interval === 'year' ? '/yr' : '/mo'
  const cta = planCheckoutCta(product, { freemium: clientFreemiumActive() })
  const noteId = `plan-cta-note-${product.id}`

  return (
    <div
      className={[
        'relative rounded-2xl bg-theme-surface p-7 flex flex-col',
        // Emphasis on the recommended tier comes from border weight and the
        // filled CTA, not from a taller card — matched heights let the two
        // prices sit on the same line and stay comparable.
        isPopular ? 'border-2 border-theme-primary' : 'border border-theme-border',
      ].join(' ')}
    >
      {/* One badge, on one card. It was on both, which emphasised nothing. */}
      {isPopular && (
        <span className="absolute -top-3 left-6 bg-theme-accent text-white font-mono text-[10px] uppercase tracking-[0.12em] px-2.5 py-1 rounded">
          Best value
        </span>
      )}

      <h3 className="text-lg mb-1">{product.name}</h3>
      <p className="text-sm text-theme-muted-text-2 mb-7">{product.description}</p>

      <div className="mb-7">
        {/*
          Tabular figures, but NOT the mono face. Plex Mono gives the decimal
          point a full monospace cell, so at display size "$99.99" reads as
          "$99 . 99". Tabular sans keeps the digits aligned between the two
          cards without that gap. Mono stays where it earns its keep — lab
          values, where 0/O and 1/l have to be unambiguous.
        */}
        {product.beforePrice > product.price && (
          <p className="text-sm text-theme-muted-text-3 line-through tabular-nums">
            {fmt(product.beforePrice)}
          </p>
        )}
        <p className="flex items-baseline gap-1.5 mt-1">
          <span className="text-4xl text-theme-text tabular-nums font-medium">{fmt(product.price)}</span>
          <span className="text-theme-muted-text-2 text-sm">{intervalLabel}</span>
        </p>
      </div>

      <div className="mt-auto">
        <Button
          onClick={handleSubscribe}
          loading={loading}
          variant={isPopular ? 'primary' : 'outline'}
          className="w-full min-h-[44px]"
          aria-describedby={noteId}
        >
          {cta.label}
        </Button>
        {/* What checkout actually does: no trial is added at checkout. */}
        <p id={noteId} className="mt-3 text-sm text-theme-muted-text-2">{cta.note}</p>

        <div aria-live="polite">
          {error && (
            <p className="mt-3 text-sm text-theme-flag-low">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
