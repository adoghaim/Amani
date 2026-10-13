import { useEffect, useId, useState } from 'react'
import { Input } from '../Input'
import { CODE_MAX_LENGTH } from '../../../supabase/functions/_shared/app-events-policy'
import type { FirstPartyEvents } from '../../lib/firstPartyEvents'

/*
  PK-EXP5 promo or referral code (owner decisions D6.1, D17, D29).

  A "Have a promo or referral code?" link above every signup route opens one
  labelled field. A valid code is held for 24 hours, so it survives the Google
  or Apple redirect, and is written to user_attribution once the account
  exists. A campaign link (/go/<key>, ?promo=, ?ref=) pre-fills it and the field
  opens already showing "Code saved: KEY". It never promises a discount (D29):
  on phones a code counts for attribution only.

  Input rule (D5.3): [A-Za-z0-9._-], at most 64 characters. Anything else gets
  an inline hint and is not held; signup is never blocked by it.

  Rendered by SignupForm only while features.first_party_events is on (D6.2).
*/

const ALLOWED = /^[A-Za-z0-9._-]*$/

interface SignupCodeFieldProps {
  events: Pick<FirstPartyEvents, 'pendingCode' | 'setPendingCode'>
}

export function SignupCodeField({ events }: SignupCodeFieldProps) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState('')
  const fieldId = useId()
  const regionId = `${fieldId}-region`

  // A campaign link (or an earlier visit within 24 hours) already holds a code.
  useEffect(() => {
    const held = events.pendingCode()
    if (held) {
      setCode(held)
      setSaved(held)
      setOpen(true)
    }
  }, [events])

  const onChange = (value: string) => {
    setCode(value)
    if (value === '') {
      events.setPendingCode(null)
      setSaved(null)
      setError('')
      return
    }
    if (!ALLOWED.test(value) || value.length > CODE_MAX_LENGTH) {
      setSaved(null)
      setError('Use only letters, numbers, dots, hyphens and underscores.')
      return
    }
    setError('')
    setSaved(events.setPendingCode(value) ? value : null)
  }

  return (
    <div data-signup-code>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(o => !o)}
        className="min-h-[44px] text-sm font-medium text-theme-primary-dark underline hover:text-theme-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme-primary rounded-lg"
      >
        Have a promo or referral code?
      </button>
      <div id={regionId} hidden={!open} className="mt-2 space-y-1.5">
        <Input
          id={fieldId}
          label="Promo or referral code"
          value={code}
          onChange={(e) => onChange(e.target.value)}
          maxLength={CODE_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          hint="Letters, numbers, dots, hyphens and underscores, up to 64 characters."
          error={error || undefined}
        />
        <p aria-live="polite" className="text-sm text-theme-text-body">
          {saved ? `Code saved: ${saved}` : ''}
        </p>
      </div>
    </div>
  )
}
