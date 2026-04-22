import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { PricingCard } from '../components/pricing/PricingCard'
import { stripeProducts } from '../stripe-config'

export function PricingPage() {
  const yearly = stripeProducts.find(p => p.interval === 'year')
  const monthly = stripeProducts.find(p => p.interval === 'month')
  const ordered = [yearly, monthly].filter(Boolean) as typeof stripeProducts

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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 max-w-3xl mx-auto">
          {ordered.map((product, index) => (
            <PricingCard
              key={product.id}
              product={product}
              isPopular={index === 0}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
