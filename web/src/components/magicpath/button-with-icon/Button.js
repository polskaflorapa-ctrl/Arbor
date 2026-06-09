import React from 'react';
import { Loader2 } from 'lucide-react';

const buttonVariants = {
  primary: {
    background: 'var(--accent-gradient)',
    borderColor: 'var(--border2)',
    color: 'var(--on-accent)',
    boxShadow: 'var(--shadow-sm)',
  },
  secondary: {
    background: 'var(--surface-field)',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    boxShadow: 'none',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'transparent',
    color: 'var(--text-sub)',
    boxShadow: 'none',
  },
  outline: {
    background: 'var(--glass-bg)',
    borderColor: 'var(--glass-border)',
    color: 'var(--text)',
    boxShadow: 'none',
  },
  danger: {
    background: 'var(--danger-surface)',
    borderColor: 'rgba(220, 38, 38, 0.24)',
    color: 'var(--danger)',
    boxShadow: 'none',
  },
  warning: {
    background: 'var(--warning-surface)',
    borderColor: 'rgba(183, 121, 31, 0.24)',
    color: 'var(--warning)',
    boxShadow: 'none',
  },
};

const buttonSizes = {
  sm: { minHeight: 34, padding: '7px 11px', fontSize: 13 },
  md: { minHeight: 40, padding: '9px 14px', fontSize: 14 },
  lg: { minHeight: 46, padding: '11px 18px', fontSize: 15 },
};

const baseStyle = {
  alignItems: 'center',
  borderRadius: 8,
  borderStyle: 'solid',
  borderWidth: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  fontFamily: 'var(--font-sans)',
  fontWeight: 800,
  gap: 8,
  justifyContent: 'center',
  letterSpacing: 0,
  lineHeight: 1.2,
  textDecoration: 'none',
  transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease',
  maxWidth: '100%',
  textAlign: 'center',
  whiteSpace: 'normal',
};

export const Button = React.forwardRef(({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon: LeftIcon,
  rightIcon: RightIcon,
  fullWidth = false,
  disabled,
  children,
  style,
  type = 'button',
  ...props
}, ref) => {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      className={className}
      style={{
        ...baseStyle,
        ...buttonVariants[variant],
        ...buttonSizes[size],
        width: fullWidth ? '100%' : undefined,
        opacity: isDisabled ? 0.58 : 1,
        pointerEvents: isDisabled ? 'none' : undefined,
        ...style,
      }}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {loading && <Loader2 size={16} style={{ animation: 'spin 0.9s linear infinite' }} aria-hidden />}
      {!loading && LeftIcon && <LeftIcon size={16} aria-hidden />}
      {children && <span style={{ minWidth: 0, opacity: loading ? 0.7 : 1, overflowWrap: 'anywhere' }}>{children}</span>}
      {!loading && RightIcon && <RightIcon size={16} aria-hidden />}
    </button>
  );
});

Button.displayName = 'Button';
