import React from 'react';

interface AmountDisplayProps {
  amount: number;
  type?: 'DEBIT' | 'CREDIT' | 'AUTO';
  showDrCr?: boolean;
  showCurrency?: boolean;
  showSign?: boolean;
  className?: string;
  size?: 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl';
}

/**
 * Clean Modern Financial Amount Formatter
 * - Debit (Dr) = Rose Red
 * - Credit (Cr) = Emerald Green
 * - Zero = Slate / Neutral
 */
export default function AmountDisplay({
  amount,
  type = 'AUTO',
  showDrCr = true,
  showCurrency = true,
  showSign = false,
  className = '',
  size = 'base'
}: AmountDisplayProps) {
  const numVal = amount || 0;
  const absAmount = Math.abs(numVal);
  const formattedNumber = absAmount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let isDebit = false;
  let isCredit = false;

  if (type === 'DEBIT') {
    isDebit = true;
  } else if (type === 'CREDIT') {
    isCredit = true;
  } else {
    // AUTO: positive balance = due to us (Debit/Red), negative balance = Advance/Credit (Green)
    if (numVal > 0) isDebit = true;
    else if (numVal < 0) isCredit = true;
  }

  let colorClass = 'text-slate-700';
  let badgeSuffix = '';
  let signPrefix = '';

  if (absAmount === 0) {
    colorClass = 'text-slate-600';
    if (showDrCr) {
      if (type === 'CREDIT') badgeSuffix = ' Cr';
      else if (type === 'DEBIT') badgeSuffix = ' Dr';
      else badgeSuffix = '';
    }
  } else if (isDebit) {
    colorClass = 'text-rose-600';
    badgeSuffix = showDrCr ? ' Dr' : '';
    signPrefix = showSign ? '-' : '';
  } else if (isCredit) {
    colorClass = 'text-emerald-600';
    badgeSuffix = showDrCr ? ' Cr' : '';
    signPrefix = showSign ? '+' : '';
  }

  const sizeClasses = {
    xs: 'text-xs font-semibold',
    sm: 'text-sm font-semibold',
    base: 'text-base font-semibold',
    lg: 'text-lg font-bold',
    xl: 'text-xl font-bold',
    '2xl': 'text-2xl font-bold tracking-tight',
    '3xl': 'text-3xl font-extrabold tracking-tight'
  };

  return (
    <span className={`inline-flex items-baseline font-sans tabular-nums select-all ${sizeClasses[size]} ${colorClass} ${className}`}>
      {signPrefix}
      {showCurrency && <span className="font-sans mr-0.5 text-[0.88em] font-normal opacity-90">₹</span>}
      <span>{formattedNumber}</span>
      {showDrCr && badgeSuffix && (
        <span className={`ml-1 text-[0.72em] font-bold tracking-wide uppercase ${
          absAmount === 0 
            ? 'text-slate-500' 
            : isDebit 
            ? 'text-rose-600' 
            : 'text-emerald-600'
        }`}>
          {badgeSuffix.trim()}
        </span>
      )}
    </span>
  );
}
