'use client';

import { type HTMLAttributes, forwardRef } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'error' | 'info' | 'default';
  size?: 'sm' | 'md';
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = 'default', size = 'md', className = '', children, ...props }, ref) => {
    const variantStyles = {
      default:
        'bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
      success:
        'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
      warning:
        'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
      error:
        'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400',
      info:
        'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400',
    };

    const sizeStyles = {
      sm: 'px-2 py-0.5 text-xs',
      md: 'px-2.5 py-0.5 text-xs',
    };

    return (
      <span
        ref={ref}
        className={`inline-flex items-center gap-1 rounded-full font-medium ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';