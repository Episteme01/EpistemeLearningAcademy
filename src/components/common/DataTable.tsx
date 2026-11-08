import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { EmptyState, Pagination, Spinner, TableWrap, Td, Th, usePagination, ErrorState } from '@/components/ui/data';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** shown as the card title on mobile */
  primary?: boolean;
  hideOnMobile?: boolean;
}

/**
 * Responsive data table: a semantic table from md upwards and a stacked card list on phones
 * (not a squeezed desktop table).
 */
export function DataTable<T extends { id: string }>({
  columns, rows, loading, error, emptyTitle = 'Nothing here yet', emptyDescription, emptyAction, pageSize = 15, onRowClick, toolbar,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean; error?: string | null;
  emptyTitle?: string; emptyDescription?: string; emptyAction?: ReactNode; pageSize?: number; onRowClick?: (row: T) => void; toolbar?: ReactNode;
}) {
  const pg = usePagination(rows, pageSize);
  const primary = columns.find((c) => c.primary) ?? columns[0];
  return (
    <Card className="overflow-hidden print-area">
      {toolbar && <div className="no-print flex flex-wrap items-center gap-2 border-b border-line p-3">{toolbar}</div>}
      {error ? <ErrorState message={error} /> : loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
          <div className="hidden md:block">
            <TableWrap>
              <thead><tr>{columns.map((c) => <Th key={c.key} className={c.className}>{c.header}</Th>)}</tr></thead>
              <tbody>
                {pg.slice.map((r) => (
                  <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn('hover:bg-cream/70', onRowClick && 'cursor-pointer')}>
                    {columns.map((c) => <Td key={c.key} className={c.className}>{c.cell(r)}</Td>)}
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
          <ul className="divide-y divide-line md:hidden">
            {pg.slice.map((r) => (
              <li key={r.id} className="space-y-2 p-4" onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {primary && <div className="font-medium text-forest-700">{primary.cell(r)}</div>}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[13px]">
                  {columns.filter((c) => c !== primary && !c.hideOnMobile).map((c) => (
                    <div key={c.key} className={c.key === 'actions' ? 'col-span-2' : ''}>
                      {c.key !== 'actions' && <dt className="text-[11px] uppercase tracking-wide text-muted">{c.header}</dt>}
                      <dd>{c.cell(r)}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <Pagination {...pg} />
        </>
      )}
    </Card>
  );
}
