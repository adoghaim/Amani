import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PricingCard } from '../components/pricing/PricingCard'
import { IapPaywall } from '../components/pricing/IapPaywall'
import { stripeProducts } from '../stripe-config'
import { isNative } from '../lib/native'

export function PricingPage() {
  const navigate = useNavigate()
  const yearly = stripeProducts.find(p => p.interval === 'year')
  const monthly = stripeProducts.find(p => p.interval === 'month')
  const ordered = [yearly, monthly].filter(Boolean) as typeof stripeProducts

  /*
    The one branch that keeps this app in the App Store. Guideline 3.1.1
    requires digital content unlocking in-app functionality to be sold through
    in-app purchase, so the native builds must never reach Stripe Checkout —
    which is exactly what `PricingCard` opens.
  */
  const native = isNative()

  return (
    <div className="min-h-screen bg-theme-background py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <Link
          to="/app"
          className="inline-flex items-center text-theme-muted-text hover:text-theme-text mb-10 transition-colors text-sm"
        >
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back to Dashboard
        </Link>

        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-theme-text mb-3">
            Choose your plan
          </h1>
          <p className="text-theme-muted-text text-base">
            Founders Launch pricing available for a limited time.
          </p>
        </div>

        {native ? (
          <IapPaywall onEntitled={() => navigate('/app')} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {ordered.map((product, index) => (
              <PricingCard
                key={product.id}
                product={product}
                isPopular={index === 0}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
