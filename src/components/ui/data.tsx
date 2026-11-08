import { useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function Spinner({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div role="status" className={cn('flex items-center justify-center gap-2 py-12 text-sm text-muted', className)}>
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-forest-50 p-3 text-forest-400">{icon ?? <Inbox className="h-6 w-6" aria-hidden />}</div>
      <p className="font-heading text-[15px] font-semibold text-forest-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div role="alert" className="m-4 rounded-md border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
      {message}
    </div>
  );
}

type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'gold';
const tones: Record<Tone, string> = {
  neutral: 'bg-forest-50 text-forest-700',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  gold: 'bg-gold-100 text-gold-600',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium capitalize', tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  published: 'ok', active: 'ok', paid: 'ok', present: 'ok', approved: 'ok', completed: 'ok', graded: 'ok', enrolled: 'ok', admitted: 'ok', released: 'ok',
  draft: 'neutral', new: 'info', submitted: 'info', in_progress: 'info', review: 'warn', partial: 'warn', late: 'warn', pending: 'warn', applicant: 'warn', unpublished: 'neutral',
  unpaid: 'warn', overdue: 'danger', absent: 'danger', suspended: 'danger', cancelled: 'danger', withdrawn: 'danger', inactive: 'neutral', closed: 'neutral', excused: 'info',
};
export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace(/_/g, ' ')}</Badge>;
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-forest-50', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-gold-400 transition-all duration-500" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Avatar({ name, src, size = 36 }: { name: string; src?: string; size?: number }) {
  const ini = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  return src ? (
    <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className="inline-flex items-center justify-center rounded-full bg-forest-700 font-heading text-xs font-medium text-gold-300"
      style={{ width: size, height: size }}
    >
      {ini || '?'}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="no-print flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
            value === t.id ? 'border-gold-400 text-forest-700' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Horizontally scrollable table wrapper; on phones tables scroll inside the card instead of breaking layout. */
export function TableWrap({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th scope="col" className={cn('whitespace-nowrap border-b border-line bg-cream px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted', className)}>{children}</th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cn('border-b border-line/70 px-4 py-3 align-middle', className)}>{children}</td>
);

export function usePagination<T>(rows: T[], pageSize = 15) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);
  return { page: current, pages, setPage, slice: rows.slice((current - 1) * pageSize, current * pageSize), total: rows.length };
}

export function Pagination({ page, pages, total, setPage }: { page: number; pages: number; total: number; setPage: (p: number) => void }) {
  if (pages <= 1) return <div className="px-4 py-2 text-xs text-muted">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="no-print flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span>{total} records</span>
      <div className="flex items-center gap-2">
        <Button size="icon" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <span>Page {page} of {pages}</span>
        <Button size="icon" variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}
