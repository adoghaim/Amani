import { useState } from 'react'
import { Button } from '../Button'
import { StripeProduct, formatPrice } from '../../stripe-config'
import { supabase } from '../../lib/supabase'
import { openExternalUrl } from '../../lib/native'
import { errorMessage } from '../../lib/errors'

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
          success_url: `${import.meta.env.VITE_APP_URL || window.location.origin}/success`,
          cancel_url: `${import.meta.env.VITE_APP_URL || window.location.origin}/app/pricing`,
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
    <div className={`relative rounded-2xl border-2 ${isPopular ? 'border-theme-primary shadow-xl' : 'border-theme-border shadow-sm'} bg-theme-surface p-8 flex flex-col`}>
      <div className="absolute -top-3 left-6">
        <span className="bg-theme-primary text-white text-xs font-semibold px-3 py-1 rounded-full tracking-wide uppercase">
          Founders Launch
        </span>
      </div>

      {isPopular && (
        <div className="absolute -top-3 right-6">
          <span className="bg-theme-text text-white text-xs font-semibold px-3 py-1 rounded-full tracking-wide">
            Best Value
          </span>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-lg font-semibold text-theme-text mb-1">
          {product.name}
        </h3>
        <p className="text-sm text-theme-muted-text mb-6">
          {product.description}
        </p>

        <div className="mb-8">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-theme-muted-text line-through">
              {fmt(product.beforePrice)}
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-theme-text">
              {fmt(product.price)}
            </span>
            <span className="text-theme-muted-text text-sm">
              {intervalLabel}
            </span>
          </div>
        </div>

        <Button
          onClick={handleSubscribe}
          loading={loading}
          variant={isPopular ? 'primary' : 'outline'}
          className="w-full"
        >
          Get Started
        </Button>

        {error && (
          <p className="mt-3 text-sm text-theme-danger text-center">{error}</p>
        )}
      </div>
    </div>
  )
}
