'use client';

import { type InputHTMLAttributes, forwardRef, useId } from 'react';

interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  labelPosition?: 'left' | 'right';
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  ({ label, labelPosition = 'left', className = '', id, ...props }, ref) => {
    const generatedId = useId();
    const toggleId = id || generatedId;

    return (
      <label className={`inline-flex items-center gap-3 cursor-pointer ${className}`}>
        {labelPosition === 'left' && label && (
          <span className="text-sm text-[var(--color-text)]">{label}</span>
        )}
        <div className="relative">
          <input
            ref={ref}
            type="checkbox"
            id={toggleId}
            className={`
              peer h-6 w-6 appearance-none rounded-full border-2 border-[var(--color-border)] 
              bg-[var(--color-surface)] transition-all duration-150
              checked:bg-[var(--color-primary)] checked:border-[var(--color-primary)] checked:after:translate-x-full
              after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:duration-150
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
            {...props}
          />
        </div>
        {labelPosition === 'right' && label && (
          <span className="text-sm text-[var(--color-text)]">{label}</span>
        )}
      </label>
    );
  }
);

Toggle.displayName = 'Toggle';