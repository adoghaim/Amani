import { useState } from 'react'
import { Button } from '../Button'
import { StripeProduct, formatPrice } from '../../stripe-config'
import { supabase } from '../../lib/supabase'
import { publicUrl } from '../../lib/appUrl';
import { openExternalUrl } from '../../lib/native'
import { errorMessage } from '../../lib/errors'
import { clientFreemiumActive } from '../../lib/tier'
import { FREEMIUM_COPY } from '../../lib/freemium/copy'

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
          mode: product.mode
        })
      })

      const data = await response.json()

      if (data.url) {
        await openExternalUrl(data.url)
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
          className="w-full"
        >
          {clientFreemiumActive() ? FREEMIUM_COPY.pricing.subscribe : 'Start free trial'}
        </Button>

        {error && (
          <p className="mt-3 text-sm text-theme-flag-low text-center">{error}</p>
        )}
      </div>
    </div>
  )
}
