import React from 'react'
import { useAuth } from '../hooks/useAuth'
import { useSubscription } from '../hooks/useSubscription'
import { Button } from '../components/ui/Button'
import { Heart, Shield, Zap } from 'lucide-react'

export function HomePage() {
  const { user } = useAuth()
  const { getActivePlan, isActive } = useSubscription()

  const activePlan = getActivePlan()

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {user ? (
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">
              Welcome back!
            </h1>
            {activePlan && isActive() ? (
              <p className="text-xl text-gray-600">
                You're on the <span className="font-semibold text-indigo-600">{activePlan}</span> plan
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-xl text-gray-600">
                  Ready to unlock your health potential?
                </p>
                <Button
                  onClick={() => window.location.href = '/pricing'}
                  size="lg"
                >
                  View Plans
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-6">
              Your Health Journey Starts Here
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto">
              Discover personalized insights, track your progress, and optimize your wellness with our comprehensive health platform.
            </p>
            <div className="space-x-4">
              <Button
                onClick={() => window.location.href = '/signup'}
                size="lg"
              >
                Get Started
              </Button>
              <Button
                onClick={() => window.location.href = '/pricing'}
                variant="outline"
                size="lg"
              >
                View Plans
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16">
          <div className="text-center p-6">
            <div className="flex justify-center mb-4">
              <Heart className="h-12 w-12 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Personalized Insights
            </h3>
            <p className="text-gray-600">
              Get tailored recommendations based on your unique health profile and goals.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="flex justify-center mb-4">
              <Shield className="h-12 w-12 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Secure & Private
            </h3>
            <p className="text-gray-600">
              Your health data is protected with enterprise-grade security and privacy measures.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="flex justify-center mb-4">
              <Zap className="h-12 w-12 text-indigo-600" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              Real-time Tracking
            </h3>
            <p className="text-gray-600">
              Monitor your progress with advanced analytics and real-time health metrics.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}