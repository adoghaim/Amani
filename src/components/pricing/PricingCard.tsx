import React, { useState } from 'react'
import { Button } from '../ui/Button'
import { StripeProduct } from '../../stripe-config'
import { supabase } from '../../lib/supabase'

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
          success_url: `${window.location.origin}/success`,
          cancel_url: `${window.location.origin}/app/pricing`,
          mode: product.mode
        })
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        setError(data.error || 'Something went wrong. Please try again.')
      }
    } catch (err) {
      setError('Unable to connect. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const fmt = (price: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(price)

  const intervalLabel = product.interval === 'year' ? '/yr' : '/mo'

  return (
    <div className={`relative rounded-2xl border-2 ${isPopular ? 'border-rose-400 shadow-xl' : 'border-gray-200 shadow-sm'} bg-white p-8 flex flex-col`}>
      <div className="absolute -top-3 left-6">
        <span className="bg-rose-500 text-white text-xs font-semibold px-3 py-1 rounded-full tracking-wide uppercase">
          Founders Launch
        </span>
      </div>

      {isPopular && (
        <div className="absolute -top-3 right-6">
          <span className="bg-gray-900 text-white text-xs font-semibold px-3 py-1 rounded-full tracking-wide">
            Best Value
          </span>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">
          {product.name}
        </h3>
        <p className="text-sm text-gray-500 mb-6">
          {product.description}
        </p>

        <div className="mb-8">
          <div className="flex items-baseline gap-2">
            <span className="text-sm text-gray-400 line-through">
              {fmt(product.beforePrice)}
            </span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-gray-900">
              {fmt(product.price)}
            </span>
            <span className="text-gray-500 text-sm">
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
          <p className="mt-3 text-sm text-red-600 text-center">{error}</p>
        )}
      </div>
    </div>
  )
}
