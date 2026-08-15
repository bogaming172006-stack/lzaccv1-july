import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  key?: React.Key;
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  hoverable?: boolean;
}

export function Card({ children, className = '', onClick, hoverable = false, ...props }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden ${
        hoverable ? 'hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer' : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function CardHeader({ title, subtitle, action, className = '' }: CardHeaderProps) {
  return (
    <div className={`px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4 bg-slate-50/50 ${className}`}>
      <div>
        <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight font-sans">
          {title}
        </h3>
        {subtitle && <p className="text-xs text-slate-700 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-3.5 bg-slate-50/70 border-t border-slate-100 ${className}`}>{children}</div>;
}
