/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly EXPO_PUBLIC_SUPABASE_URL: string
  readonly EXPO_PUBLIC_SUPABASE_ANON_KEY: string
  // Add more EXPO_PUBLIC_ variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
