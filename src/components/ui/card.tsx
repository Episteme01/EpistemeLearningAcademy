import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-line bg-white shadow-card', className)} {...p} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...p} />;
}

export function StatCard({ label, value, hint, icon, tone = 'default' }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'gold' | 'danger' | 'ok';
}) {
  const bar = { default: 'bg-forest-700', gold: 'bg-gold-400', danger: 'bg-danger', ok: 'bg-ok' }[tone];
  return (
    <Card className="relative overflow-hidden">
      <span className={cn('absolute inset-y-0 left-0 w-1', bar)} aria-hidden />
      <div className="flex items-start justify-between gap-3 p-5 pl-6">
        <div className="min-w-0">
          <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-1 font-heading text-2xl font-semibold text-forest-700">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        {icon && <div className="text-gold-500" aria-hidden>{icon}</div>}
      </div>
    </Card>
  );
}

export function PageHeader({ title, description, actions, crumbs }: { title: string; description?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumbs}
        <h1 className="text-2xl font-semibold md:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
