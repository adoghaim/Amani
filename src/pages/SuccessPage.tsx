import React, { useEffect } from 'react'
import { CheckCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { useSubscription } from '../hooks/useSubscription'

export function SuccessPage() {
  const { refetch } = useSubscription()

  useEffect(() => {
    // Refetch subscription data after successful payment
    const timer = setTimeout(() => {
      refetch()
    }, 2000)

    return () => clearTimeout(timer)
  }, [refetch])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex justify-center mb-6">
            <CheckCircle className="h-16 w-16 text-green-500" />
          </div>
          
          <h1 className="text-2xl font-bold text-gray-900 mb-4">
            Payment Successful!
          </h1>
          
          <p className="text-gray-600 mb-8">
            Thank you for your subscription. You now have access to all premium features.
          </p>
          
          <Button
            onClick={() => window.location.href = '/'}
            className="w-full"
          >
            Continue to Dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}