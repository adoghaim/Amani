# Amani Setup Guide

## Environment Variables

Copy `.env.example` to `.env` and fill in the following values:

```
EXPO_PUBLIC_SUPABASE_URL=your_supabase_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key (optional for now)
```

## Supabase Edge Function Environment

The `generate-interpretation` edge function requires the following environment variable:

- `OPENAI_API_KEY` - Your OpenAI API key for gpt-4o-2024-08-06

Set this in your Supabase dashboard under Edge Functions secrets.

## Database

The database schema has been created with the following tables:
- `users` - User accounts and subscription info
- `lab_reports` - Lab report metadata
- `biomarkers` - Individual biomarker values
- `interpretations` - AI-generated interpretations

A storage bucket `lab-files` has been created for file uploads.

## Features Implemented

### Authentication
- Email/password signup and login
- Trial system (30 days free)
- User profile management

### Lab Reports
- Multi-step wizard for creating reports
- File upload (PDF/images)
- Biomarker entry
- Cycle phase calculation
- AI interpretation generation

### Subscription Management
- Trial status tracking
- Billing page (requires Stripe integration)
- Access control based on subscription status

### Report Viewing
- AI interpretation display
- Biomarker breakdown
- Cycle context
- Questions for doctor
- Supportive considerations
- Report regeneration (max 3 times)

### Settings
- Account information
- Account deletion with data cleanup

## Next Steps

1. Configure OpenAI API key for edge function
2. (Optional) Set up Stripe for subscription payments
3. Test the complete flow

## Important Notes

- The app prioritizes calm, educational language
- All disclaimers are in place
- RLS policies ensure data privacy
- File storage is per-user secured
