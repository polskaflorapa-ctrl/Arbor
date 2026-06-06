import React from 'react';
import { motion } from 'framer-motion';
import { GitBranch } from 'lucide-react';

const buttonStyle = {
  alignItems: 'center',
  background: 'var(--glass-bg)',
  border: '1px solid var(--glass-border)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-sm)',
  color: 'var(--text)',
  cursor: 'pointer',
  display: 'inline-flex',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 800,
  gap: 8,
  justifyContent: 'center',
  letterSpacing: 0,
  minHeight: 40,
  padding: '9px 14px',
  transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease',
  whiteSpace: 'nowrap',
};

export const ButtonWithIconVariant = React.forwardRef(({
  className,
  children = 'New Branch',
  disabled,
  style,
  ...props
}, ref) => (
  <motion.button
    ref={ref}
    className={className}
    style={{
      ...buttonStyle,
      opacity: disabled ? 0.58 : 1,
      pointerEvents: disabled ? 'none' : undefined,
      ...style,
    }}
    disabled={disabled}
    whileHover={!disabled ? { scale: 1.02 } : undefined}
    whileTap={!disabled ? { scale: 0.98 } : undefined}
    transition={{ duration: 0.15, ease: 'easeInOut' }}
    {...props}
  >
    <GitBranch size={16} aria-hidden />
    <span>{children}</span>
  </motion.button>
));

ButtonWithIconVariant.displayName = 'ButtonWithIconVariant';
