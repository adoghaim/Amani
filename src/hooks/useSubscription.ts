import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { getProductByPriceId } from '../stripe-config'

export interface Subscription {
  customer_id: string | null
  subscription_id: string | null
  subscription_status: string | null
  price_id: string | null
  current_period_start: number | null
  current_period_end: number | null
  cancel_at_period_end: boolean | null
  payment_method_brand: string | null
  payment_method_last4: string | null
}

export function useSubscription() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchSubscription()
  }, [])

  const fetchSubscription = async () => {
    try {
      const { data, error } = await supabase
        .from('stripe_user_subscriptions')
        .select('*')
        .maybeSingle()

      if (error) {
        console.error('Error fetching subscription:', error)
        return
      }

      setSubscription(data)
    } catch (error) {
      console.error('Error fetching subscription:', error)
    } finally {
      setLoading(false)
    }
  }

  const getActivePlan = () => {
    if (!subscription?.price_id) return null
    
    const product = getProductByPriceId(subscription.price_id)
    return product?.name || null
  }

  const isActive = () => {
    return subscription?.subscription_status === 'active'
  }

  return {
    subscription,
    loading,
    getActivePlan,
    isActive,
    refetch: fetchSubscription
  }
}