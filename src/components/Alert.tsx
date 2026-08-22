import React from 'react';
import { CheckCircle, XCircle, AlertCircle, Info } from 'lucide-react';

interface AlertProps {
  type?: 'success' | 'error' | 'warning' | 'info';
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function Alert({ type = 'info', title, children, className = '' }: AlertProps) {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
  };

  const colors = {
    success: 'bg-theme-flag-ok-bg border-theme-flag-ok-border text-theme-flag-ok',
    error: 'bg-theme-flag-low-bg border-theme-flag-low-border text-theme-flag-low',
    warning: 'bg-theme-flag-watch-bg border-theme-flag-watch-border text-theme-flag-watch',
    info: 'bg-theme-info-bg border-theme-info-border text-theme-info',
  };

  const iconColors = {
    success: 'text-theme-flag-ok',
    error: 'text-theme-flag-low',
    warning: 'text-theme-flag-watch',
    info: 'text-theme-info',
  };

  const Icon = icons[type];

  return (
    <div className={`rounded-xl border p-4 ${colors[type]} ${className}`}>
      <div className="flex">
        <div className="flex-shrink-0">
          <Icon className={`h-5 w-5 ${iconColors[type]}`} />
        </div>
        <div className="ml-3">
          {title && (
            <h3 className="text-sm font-medium mb-1">
              {title}
            </h3>
          )}
          <div className="text-sm">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
