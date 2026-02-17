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

  const handleSubscribe = async () => {
    setLoading(true)
    
    try {
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        window.location.href = '/login'
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
          cancel_url: `${window.location.origin}/pricing`,
          mode: product.mode
        })
      })

      const data = await response.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        console.error('No checkout URL returned')
      }
    } catch (error) {
      console.error('Error creating checkout session:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(price)
  }

  return (
    <div className={`relative rounded-2xl border ${isPopular ? 'border-indigo-500 shadow-lg' : 'border-gray-200'} bg-white p-8`}>
      {isPopular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-indigo-500 text-white px-4 py-1 rounded-full text-sm font-medium">
            Most Popular
          </span>
        </div>
      )}
      
      <div className="text-center">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">
          {product.name}
        </h3>
        
        <p className="text-gray-600 mb-6">
          {product.description}
        </p>
        
        <div className="mb-8">
          <span className="text-4xl font-bold text-gray-900">
            {formatPrice(product.price)}
          </span>
          <span className="text-gray-600 ml-1">
            /{product.name.toLowerCase().includes('yearly') ? 'year' : 'month'}
          </span>
        </div>
        
        <Button
          onClick={handleSubscribe}
          loading={loading}
          variant={isPopular ? 'primary' : 'outline'}
          className="w-full"
        >
          Get Started
        </Button>
      </div>
    </div>
  )
}