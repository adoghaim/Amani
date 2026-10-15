/*
  ============================================================================
  DRAFT COPY — FOR LAWYER APPROVAL (owner decision D7.1). NOT LEGAL ADVICE.

  Every string the consent screens, the exits and the Settings withdrawal show
  is in this file, so the lawyer reviews one place. The screens ship behind
  features.consent_gate, which stays OFF until the owner has the lawyer's
  approval of this copy; flipping it on is the owner's launch step (D6.2).

  Headings and the decline line are the owner-approved design (D4, D5, D13).
  The rest is written from what the app does today, in the words of
  src/pages/Privacy.tsx (itself a draft pending legal review). When the lawyer
  changes the meaning of any consent, bump CURRENT_CONSENT_VERSION (server,
  client and consent_required_version() in a new migration) so everyone is
  asked again.
  ============================================================================
*/
import type { ConsentType } from '../../lib/consent/consentPolicy';

export const CONSENT_COPY_STATUS = 'DRAFT: pending lawyer approval (D7.1)';

export interface ConsentStepCopy {
  type: ConsentType;
  heading: string;
  sentence: string;
  whatThisMeans: readonly string[];
  checkboxLabel: string;
  /** The quiet secondary link: "I'm under 18" on step 1, "No thanks" on the others. */
  secondaryLabel: string;
}

export const CONSENT_STEPS: readonly ConsentStepCopy[] = [
  {
    type: 'age_18_plus',
    heading: "You're 18 or older",
    sentence: 'Amani is for adults. Please confirm your age to continue.',
    whatThisMeans: [
      'Amani explains lab results for adults only. We do not knowingly hold information about anyone under 18.',
      "If you're under 18, tap \"I'm under 18\" and we'll remove the account you just made.",
    ],
    checkboxLabel: "I confirm I'm 18 or older",
    secondaryLabel: "I'm under 18",
  },
  {
    type: 'health_data',
    heading: 'Amani can process your health data',
    sentence: 'We store and read the lab reports and health details you choose to share, to explain your results.',
    whatThisMeans: [
      'This consent is separate from our Terms of Service. It covers your lab reports, the values in them, and the health details you add, such as your cycle, symptoms and reproductive status.',
      'We use them to give you your explanations and your history. We do not sell them, and we do not share them with advertisers.',
      'You can withdraw this consent at any time in Settings, under Privacy & security, and delete your data there.',
    ],
    checkboxLabel: 'I agree that Amani can process my health data',
    secondaryLabel: 'No thanks',
  },
  {
    type: 'ai_processing',
    heading: 'An AI service can read your lab values to write your explanation',
    sentence: 'Amani sends your lab values to OpenAI, an AI service, which writes the explanation of your results.',
    whatThisMeans: [
      'We send OpenAI the test names, values and units from your report with the limits your lab printed beside them, its cycle context, and a short profile: your first name, age bracket, sex at birth, reproductive status, goals and the symptoms you asked us to keep in mind.',
      'A photo of your report, or a PDF we cannot read ourselves, is sent as an image, and it shows whatever your lab printed, which usually includes your name and date of birth. We never send your email address or your password.',
      'OpenAI states that data sent through its API is not used to train its models. Amani needs this to explain your results.',
    ],
    checkboxLabel: 'I agree that an AI service can read my lab values',
    secondaryLabel: 'No thanks',
  },
];

export const PRIVACY_LINK_LABEL = 'Read how we handle your data in our Privacy Policy';

export const CONTINUE_LABEL = 'Continue';

/** D5: the calm exit when she declines. Her account stays. */
export const DECLINE_EXIT = {
  heading: 'Amani needs this to explain your results',
  sentence: 'You can come back any time. Your account stays as it is.',
  primary: 'Go back',
  secondary: 'Sign out',
} as const;

/** D13, an account that already holds her data: one confirmation before it is removed. */
export const UNDER_18_CONFIRM = {
  heading: 'Amani is for adults 18 and over',
  sentence: "If you're under 18, we'll remove your account and everything in it, and sign you out.",
  primary: 'Remove my account',
  secondary: "Go back, I'm 18 or older",
} as const;

/** D13: the exit after the account has been removed. Rendered from local state. */
export const UNDER_18_EXIT = {
  heading: 'Amani is for adults 18 and over',
  sentence: "We've removed your account.",
  primary: 'Done',
} as const;

export const NOTICES = {
  saveFailed: { title: "We couldn't save your answer.", safe: 'Nothing has been shared.', action: 'Try again' },
  removeFailed: { title: "We couldn't remove your account just now.", safe: 'Nothing else has changed.', action: 'Try again' },
  loadFailed: {
    heading: "We couldn't check your consent",
    sentence: 'Amani needs to confirm your consent before it can read or explain lab reports.',
    title: 'Something went wrong while checking.',
    safe: 'Your reports and results are saved.',
    primary: 'Try again',
  },
} as const;

/** Settings > Privacy & security (D25). */
export const SETTINGS_COPY = {
  heading: 'Your consent',
  given: 'You have given all three consents Amani needs.',
  notGiven: 'Amani is not processing new lab reports, because a consent is missing or withdrawn.',
  labels: {
    age_18_plus: "You're 18 or older",
    health_data: 'Amani can process your health data',
    ai_processing: 'An AI service can read your lab values',
  } satisfies Record<ConsentType, string>,
  statusGiven: 'Given',
  statusNotGiven: 'Not given',
  withdraw: 'Withdraw consent',
  withdrawExplain: [
    'If you withdraw, Amani stops reading new lab reports and stops writing explanations, straight away.',
    'Your saved reports stay in your account until you delete them. You can delete your account and all your data below, under Your data.',
  ],
  withdrawConfirm: 'Withdraw my consent',
  withdrawCancel: 'Keep my consent',
  withdrawn: 'Your consent is withdrawn. Amani will not process new lab reports.',
  deleteOffer: 'Delete my data',
  giveAgain: 'Give consent',
  withdrawFailed: { title: "We couldn't record your withdrawal.", safe: 'Nothing has changed yet.', action: 'Try again' },
} as const;
