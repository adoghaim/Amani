import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { firstPartyEvents } from '../lib/firstPartyEventsClient'

/*
  PK-EXP5 app-level hooks. Both do nothing while features.first_party_events
  is off (D6.2), never throw, and never block a render.

  - The URL the app was opened at is read during the first render, before any
    route redirects it, and handed to captureEntry: first-touch utm_*, promo
    and ref, a campaign code, and landing_view on "/".
  - When a signed-in user appears and a signup was started on this device in
    the last 24 hours, completeSignup saves the attribution once and logs
    signup_completed. One place for the email form and the Google or Apple
    round trip alike.
*/
export function FirstPartyEventsLifecycle() {
  const { user } = useAuth()
  const [entry] = useState(() =>
    typeof window === 'undefined' ? null : { pathname: window.location.pathname, search: window.location.search })

  useEffect(() => {
    if (entry) void firstPartyEvents.captureEntry(entry)
  }, [entry])

  const userId = user?.id
  const createdAt = user?.created_at
  useEffect(() => {
    if (userId) void firstPartyEvents.completeSignup({ id: userId, created_at: createdAt })
  }, [userId, createdAt])

  return null
}

/*
  A campaign link, /go/<key> (D17, D29). With the flag on, the key is captured
  as the first-touch ref and pre-fills the signup code field ("Code saved:
  KEY"). Either way the visitor lands on signup; nothing promises a discount.
*/
export function CampaignLinkRedirect() {
  const location = useLocation()
  useEffect(() => {
    void firstPartyEvents.captureEntry({ pathname: location.pathname, search: location.search })
  }, [location.pathname, location.search])
  return <Navigate to="/signup" replace />
}
