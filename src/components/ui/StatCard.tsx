import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  trend?: {
    value: string;
    isPositive: boolean;
    label?: string;
  };
  variant?: 'default' | 'debit' | 'credit' | 'navy';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = 'text-slate-700',
  iconBg = 'bg-slate-100',
  trend,
  variant = 'default',
  action
}: StatCardProps) {
  const borderHighlight = 
    variant === 'debit' ? 'border-l-2 sm:border-l-4 border-l-rose-500' :
    variant === 'credit' ? 'border-l-2 sm:border-l-4 border-l-emerald-500' :
    variant === 'navy' ? 'border-l-2 sm:border-l-4 border-l-blue-600' :
    '';

  return (
    <div className={`bg-white rounded-lg sm:rounded-xl border border-slate-200 p-1.5 min-[400px]:p-2 sm:p-5 shadow-2xs transition-all hover:shadow-xs ${borderHighlight}`}>
      <div className="flex items-start justify-between gap-1">
        <div className="space-y-0 min-w-0 flex-1">
          <p className="text-[8.5px] min-[400px]:text-[9.5px] sm:text-xs font-medium uppercase tracking-wider text-slate-500 font-sans truncate">
            {title}
          </p>
          <div className="text-[11.5px] min-[400px]:text-xs sm:text-2xl font-medium sm:font-bold text-slate-900 tracking-tight font-sans select-all mt-0.5">
            {value}
          </div>
        </div>

        {Icon && (
          <div className={`p-1 sm:p-2 rounded-md sm:rounded-lg ${iconBg} ${iconColor} shrink-0 ${iconBg?.includes('bg-transparent') ? '' : 'border border-slate-200/60'} hidden min-[440px]:flex items-center justify-center`}>
            <Icon className="w-3.5 h-3.5 sm:w-5 sm:h-5" />
          </div>
        )}
      </div>

      {(subtitle || trend || action) && (
        <div className="mt-1 pt-1 sm:mt-3 sm:pt-3 border-t border-slate-100 flex items-center justify-between text-[8.5px] min-[400px]:text-[9.5px] sm:text-xs text-slate-400 font-normal">
          {subtitle && <span className="truncate">{subtitle}</span>}
          {trend && (
            <span className={`font-medium inline-flex items-center gap-1 shrink-0 ${trend.isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend.isPositive ? '+' : '-'}{trend.value}
              {trend.label && <span className="text-slate-400 font-normal hidden sm:inline"> {trend.label}</span>}
            </span>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="text-blue-600 hover:text-blue-800 font-medium transition-colors ml-auto shrink-0"
            >
              {action.label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
