import React from 'react';
import { ChevronRight } from 'lucide-react';

interface BreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  badge,
  breadcrumbs,
  actions,
  className = ''
}: PageHeaderProps) {
  return (
    <div className={`mb-1 sm:mb-8 ${className}`}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center space-x-1.5 text-xs text-slate-700 mb-1 sm:mb-2 font-medium">
          {breadcrumbs.map((item, idx) => (
            <React.Fragment key={idx}>
              {idx > 0 && <ChevronRight size={13} className="text-slate-400" />}
              {item.onClick || item.href ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="hover:text-blue-600 transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              ) : (
                <span className="text-slate-700 font-semibold">{item.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 sm:gap-4">
        <div>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
            <h1 className="text-sm min-[400px]:text-base sm:text-3xl font-semibold sm:font-extrabold text-slate-900 tracking-tight font-sans">
              {title}
            </h1>
            {badge}
          </div>
          {subtitle && (
            <p className="text-[9.5px] sm:text-sm text-slate-500 mt-0.2 sm:mt-1 font-normal max-w-2xl">
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-1.5 sm:gap-2.5 flex-wrap shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
