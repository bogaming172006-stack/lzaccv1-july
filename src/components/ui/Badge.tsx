import React from 'react';

export type BadgeVariant = 
  | 'active' 
  | 'pending' 
  | 'completed' 
  | 'cancelled' 
  | 'inactive' 
  | 'draft' 
  | 'warning'
  | 'debit' 
  | 'credit'
  | 'navy'
  | 'purple'
  | 'gold'
  | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  dot?: boolean;
}

export default function Badge({
  children,
  variant = 'neutral',
  size = 'md',
  className = '',
  dot = false
}: BadgeProps) {
  const variantStyles: Record<BadgeVariant, { bg: string; text: string; border: string; dotColor: string }> = {
    active: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      dotColor: 'bg-emerald-500'
    },
    completed: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      dotColor: 'bg-emerald-500'
    },
    pending: {
      bg: 'bg-amber-50',
      text: 'text-amber-700',
      border: 'border-amber-200',
      dotColor: 'bg-amber-500'
    },
    warning: {
      bg: 'bg-amber-50',
      text: 'text-amber-800',
      border: 'border-amber-200',
      dotColor: 'bg-amber-500'
    },
    cancelled: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      border: 'border-rose-200',
      dotColor: 'bg-rose-500'
    },
    inactive: {
      bg: 'bg-slate-100',
      text: 'text-slate-600',
      border: 'border-slate-200',
      dotColor: 'bg-slate-400'
    },
    draft: {
      bg: 'bg-slate-100',
      text: 'text-slate-700',
      border: 'border-slate-200',
      dotColor: 'bg-slate-400'
    },
    debit: {
      bg: 'bg-rose-50',
      text: 'text-rose-700',
      border: 'border-rose-200',
      dotColor: 'bg-rose-500'
    },
    credit: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-200',
      dotColor: 'bg-emerald-500'
    },
    navy: {
      bg: 'bg-slate-900',
      text: 'text-white',
      border: 'border-slate-800',
      dotColor: 'bg-sky-400'
    },
    purple: {
      bg: 'bg-purple-900',
      text: 'text-amber-300',
      border: 'border-purple-800 ring-1 ring-amber-400/40',
      dotColor: 'bg-amber-400'
    },
    gold: {
      bg: 'bg-amber-50',
      text: 'text-amber-900',
      border: 'border-amber-300',
      dotColor: 'bg-amber-500'
    },
    neutral: {
      bg: 'bg-slate-50',
      text: 'text-slate-700',
      border: 'border-slate-200',
      dotColor: 'bg-slate-400'
    }
  };

  const current = variantStyles[variant] || variantStyles.neutral;
  const sizeClass = size === 'xs'
    ? 'text-[10px] px-1.5 py-0.2 font-semibold'
    : size === 'sm' 
    ? 'text-[11px] px-2 py-0.5 font-medium' 
    : 'text-xs px-2.5 py-1 font-semibold';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border ${current.bg} ${current.text} ${current.border} ${sizeClass} tracking-wide uppercase font-sans ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${current.dotColor} shrink-0`} />}
      {children}
    </span>
  );
}
