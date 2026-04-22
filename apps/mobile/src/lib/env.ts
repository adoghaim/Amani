import Constants from 'expo-constants';

interface AppExtra {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

function readExtra(): AppExtra {
  const expoExtra = (Constants.expoConfig?.extra ?? {}) as AppExtra;
  const manifestExtra = (Constants.manifest2?.extra?.expoClient?.extra ?? {}) as AppExtra;

  return {
    supabaseUrl:
      expoExtra.supabaseUrl ??
      manifestExtra.supabaseUrl ??
      process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey:
      expoExtra.supabaseAnonKey ??
      manifestExtra.supabaseAnonKey ??
      process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}

function requireConfig(value: string | undefined, key: string) {
  if (value && value.trim().length > 0) {
    return value;
  }

  throw new Error(
    `Missing mobile config: ${key}. Set it in apps/mobile/.env and expose it through app.config.ts.`
  );
}

const extra = readExtra();

export const mobileEnv = {
  supabaseUrl: requireConfig(extra.supabaseUrl, 'EXPO_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: requireConfig(extra.supabaseAnonKey, 'EXPO_PUBLIC_SUPABASE_ANON_KEY'),
} as const;
