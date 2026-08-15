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
    variant === 'debit' ? 'border-l-4 border-l-rose-500' :
    variant === 'credit' ? 'border-l-4 border-l-emerald-500' :
    variant === 'navy' ? 'border-l-4 border-l-blue-600' :
    '';

  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-5 shadow-xs transition-all hover:shadow-sm ${borderHighlight}`}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-700 font-sans">
            {title}
          </p>
          <div className="text-2xl font-bold text-slate-900 tracking-tight font-sans select-all">
            {value}
          </div>
        </div>

        {Icon && (
          <div className={`p-2.5 rounded-lg ${iconBg} ${iconColor} shrink-0 border border-slate-200/60`}>
            <Icon size={20} />
          </div>
        )}
      </div>

      {(subtitle || trend || action) && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-700">
          {subtitle && <span>{subtitle}</span>}
          {trend && (
            <span className={`font-semibold inline-flex items-center gap-1 ${trend.isPositive ? 'text-emerald-600' : 'text-rose-600'}`}>
              {trend.isPositive ? '+' : '-'}{trend.value}
              {trend.label && <span className="text-slate-600 font-normal"> {trend.label}</span>}
            </span>
          )}
          {action && (
            <button
              onClick={action.onClick}
              className="text-blue-600 hover:text-blue-800 font-semibold transition-colors ml-auto"
            >
              {action.label} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
