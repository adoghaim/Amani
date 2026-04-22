import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle } from 'lucide-react'
import { Button } from '../components/Button'
import { useSubscription } from '../hooks/useSubscription'

export function SuccessPage() {
  const { refetch } = useSubscription()
  const navigate = useNavigate()

  useEffect(() => {
    // Refetch subscription data after successful payment
    const timer = setTimeout(() => {
      refetch()
    }, 2000)

    return () => clearTimeout(timer)
  }, [refetch])

  return (
    <div className="min-h-screen bg-theme-background flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center">
        <div className="bg-theme-surface rounded-lg shadow-lg p-8 border border-theme-border">
          <div className="flex justify-center mb-6">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          
          <h1 className="text-2xl font-bold text-theme-text mb-4">
            Payment Successful!
          </h1>
          
          <p className="text-theme-muted-text mb-8">
            Thank you for your subscription. You now have access to all premium features.
          </p>
          
          <Button
            onClick={() => navigate('/', { replace: true })}
            className="w-full"
          >
            Continue to Dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}