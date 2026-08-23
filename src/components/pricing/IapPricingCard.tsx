import { useState } from 'react'
import { Button } from '../Button'
import { getStripeTwin } from '../../lib/iap-config'
import { purchaseIapProduct, syncIapEntitlement, type IapStoreProduct } from '../../lib/iap'

interface IapPricingCardProps {
  product: IapStoreProduct
  isPopular?: boolean
  /** Called once the purchase has been verified server-side. */
  onPurchased: () => void
}

/**
 * Formats an amount in the store's own currency using the device locale, so a
 * comparison price sits in the same currency as the price beside it.
 */
function formatStoreCurrency(amount: number, currencyCode: string): string | null {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(amount)
  } catch {
    // An unrecognised currency code would throw rather than degrade. Showing no
    // comparison price is fine; showing one in the wrong currency is not.
    return null
  }
}

/**
 * The comparison price, derived from the Stripe twin's *ratio* rather than its
 * amount.
 *
 * `stripe-config.ts` holds $19.99→$9.99 and $199.99→$99.99, both a straight
 * half-off. The discount is the part that travels; the dollar figures do not —
 * rendering "$199.99" struck through next to a store price of "¥15,000" is both
 * wrong and the kind of price mismatch App Review flags. So take the ratio from
 * the twin and apply it to the store's own localized price.
 */
function comparison(product: IapStoreProduct): { before: string; savingsPct: number } | null {
  const twin = getStripeTwin(product.productId)
  if (!twin || twin.price <= 0 || twin.beforePrice <= twin.price) return null

  const ratio = twin.beforePrice / twin.price
  const before = formatStoreCurrency(product.price * ratio, product.currencyCode)
  if (!before) return null

  return { before, savingsPct: Math.round((1 - 1 / ratio) * 100) }
}

/**
 * A single store product on the native paywall.
 *
 * Every price rendered here comes from StoreKit/Play, never from
 * `stripe-config.ts`: the hardcoded USD figures are wrong in every other
 * storefront, and Apple rejects a paywall whose prices disagree with the ones
 * the store returns.
 */
export function IapPricingCard({ product, isPopular = false, onPurchased }: IapPricingCardProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const intervalLabel = product.interval === 'year' ? '/yr' : '/mo'
  const periodLabel = product.interval === 'year' ? '12 months' : '1 month'
  const compare = comparison(product)

  const handlePurchase = async () => {
    setLoading(true)
    setError(null)

    const result = await purchaseIapProduct(product.productId)

    if (!result.ok) {
      // A cancelled purchase is a decision, not a failure. Saying "error" to
      // someone who just tapped Cancel is noise.
      if (!result.cancelled) setError(result.error ?? 'The purchase could not be completed')
      setLoading(false)
      return
    }

    /*
      The store says paid; the server has to agree before anything unlocks. This
      is what makes entitlement immediate rather than webhook-latent — but the
      purchase itself is safe either way, because the webhook will write the
      same row if this call fails.
    */
    const sync = await syncIapEntitlement()

    if (!sync.ok) {
      setError(
        sync.reason === 'ownership_conflict'
          ? sync.error
          : `Your purchase went through, but we couldn't activate it yet: ${sync.error}. ` +
            'It will activate automatically in a few moments — pull to refresh, or ' +
            'tap Restore Purchases.',
      )
      setLoading(false)
      return
    }

    setLoading(false)

    /*
      `ok` only means the sync call itself succeeded. Closing the paywall on
      that alone drops the user into a screen that will bounce them straight
      back, so navigate only once the server says the row entitles.
    */
    if (!sync.entitled) {
      setError(
        "Your purchase went through but hasn't activated yet — tap Restore Purchases in a moment.",
      )
      return
    }

    onPurchased()
  }

  return (
    <div
      className={`relative rounded-2xl border-2 ${isPopular ? 'border-theme-primary shadow-xl' : 'border-theme-border shadow-sm'} bg-theme-surface p-8 flex flex-col`}
    >
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
        <h3 className="text-lg font-semibold text-theme-text mb-1">{product.title}</h3>
        <p className="text-sm text-theme-muted-text mb-6">{product.description}</p>

        <div className="mb-2">
          {compare && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm text-theme-muted-text line-through">{compare.before}</span>
              <span className="text-xs font-semibold text-theme-primary">
                Save {compare.savingsPct}%
              </span>
            </div>
          )}
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-theme-text">{product.priceString}</span>
            <span className="text-theme-muted-text text-sm">{intervalLabel}</span>
          </div>
        </div>

        {/*
          Guideline 3.1.2(a) requires the length of the subscription and the
          price per period to be visible on the paywall itself, not only in the
          store sheet. Auto-renewal terms and cancellation instructions are in
          the disclosure block below the cards.
        */}
        <p className="text-xs text-theme-muted-text mb-6">
          {periodLabel} of full access &middot; {product.priceString} per{' '}
          {product.interval === 'year' ? 'year' : 'month'}, billed automatically until cancelled
        </p>

        <Button
          onClick={handlePurchase}
          loading={loading}
          variant={isPopular ? 'primary' : 'outline'}
          className="w-full"
        >
          Subscribe
        </Button>

        {error && <p className="mt-3 text-sm text-theme-danger text-center">{error}</p>}
      </div>
    </div>
  )
}
