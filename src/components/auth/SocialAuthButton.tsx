import { useState } from 'react';
import { Loader2 } from 'lucide-react';

type Provider = 'google' | 'apple';

interface SocialAuthButtonProps {
  provider: Provider;
  label: string;
  onClick: () => Promise<void>;
  disabled?: boolean;
}

const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 18 18" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
    />
  </svg>
);

const AppleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
  </svg>
);

export function SocialAuthButton({
  provider,
  label,
  onClick,
  disabled,
}: SocialAuthButtonProps) {
  const [isClicking, setIsClicking] = useState(false);

  const handleClick = async () => {
    if (isClicking || disabled) return;
    setIsClicking(true);
    try {
      await onClick();
    } finally {
      setIsClicking(false);
    }
  };

  const isApple = provider === 'apple';
  const baseClasses =
    'w-full h-11 rounded-xl border flex items-center justify-center gap-3 text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed';
  const themeClasses = isApple
    ? 'bg-black text-white border-black hover:bg-theme-neutral-800'
    : 'bg-white text-theme-neutral-800 border-theme-border hover:bg-theme-neutral-50';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || isClicking}
      aria-busy={isClicking}
      aria-label={label}
      className={`${baseClasses} ${themeClasses}`}
    >
      {isClicking ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isApple ? (
        <AppleIcon />
      ) : (
        <GoogleIcon />
      )}
      <span>{label}</span>
    </button>
  );
}
