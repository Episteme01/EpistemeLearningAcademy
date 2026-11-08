import { useMemo, useState, type ReactNode } from 'react';
import { Download, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import type { QueryConstraint } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/overlay';
import { PageHeader } from '@/components/ui/card';
import { DataTable, type Column } from './DataTable';
import { EntityForm } from './EntityForm';
import type { FieldDef } from './crudFields';
import { useCollection } from '@/hooks/useFirestore';
import { createDoc, patchDoc, removeDoc } from '@/services/db';
import { audit } from '@/services/audit';
import { downloadText, errorMessage } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { useAuth } from '@/features/auth/AuthContext';

type Row = Record<string, unknown> & { id: string };

export interface CrudConfig<T extends Row> {
  collection: string;
  singular: string;
  plural: string;
  description?: string;
  fields: FieldDef[];
  columns: Column<T>[];
  searchKeys: string[];
  filters?: { name: string; label: string; options: { value: string; label: string }[] }[];
  constraints?: () => QueryConstraint[];
  sort?: (a: T, b: T) => number;
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  /** transform the validated form payload before it is written (add computed/denormalised fields) */
  beforeSave?: (payload: Record<string, unknown>, existing: T | null) => Promise<Record<string, unknown>> | Record<string, unknown>;
  afterSave?: (id: string, payload: Record<string, unknown>, existing: T | null) => Promise<void> | void;
  beforeDelete?: (row: T) => Promise<void> | void;
  /** deterministic document id for new documents */
  idFor?: (payload: Record<string, unknown>) => string;
  rowActions?: (row: T) => ReactNode;
  headerActions?: ReactNode;
  exportColumns?: { header: string; value: (row: T) => string | number | null | undefined }[];
  auditActions?: boolean;
  dialogSize?: 'md' | 'lg' | 'xl';
  rowFilter?: (row: T) => boolean;
}

export function CrudPage<T extends Row>({ config }: { config: CrudConfig<T> }) {
  const c = config;
  const toast = useToast();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<T | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useCollection<Record<string, unknown>>(c.collection, () => c.constraints?.() ?? [], c.collection);
  const rows = data as unknown as T[];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (c.rowFilter && !c.rowFilter(r)) return false;
      for (const f of c.filters ?? []) {
        const v = filterValues[f.name];
        if (v && String(r[f.name] ?? '') !== v) return false;
      }
      if (!q) return true;
      return c.searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q));
    });
    return c.sort ? out.sort(c.sort) : out;
  }, [rows, search, filterValues, c]);

  const save = async (payload: Record<string, unknown>) => {
    try {
      const existing = editing;
      const final = c.beforeSave ? await c.beforeSave(payload, existing) : payload;
      let id: string;
      if (existing) {
        await patchDoc(c.collection, existing.id, final);
        id = existing.id;
      } else {
        id = await createDoc(c.collection, { ...final, createdBy: profile ? profile.email : '' }, c.idFor?.(final));
      }
      await c.afterSave?.(id, final, existing);
      if (c.auditActions) void audit(existing ? `${c.collection}.update` : `${c.collection}.create`, `${c.collection}/${id}`);
      toast.success(`${c.singular} ${existing ? 'updated' : 'created'}`);
      setEditing(null);
      setCreating(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await c.beforeDelete?.(deleting);
      await removeDoc(c.collection, deleting.id);
      if (c.auditActions) void audit(`${c.collection}.delete`, `${c.collection}/${deleting.id}`);
      toast.success(`${c.singular} deleted`);
      setDeleting(null);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<T>[] = [
    ...c.columns,
    ...(c.canEdit !== false || c.canDelete !== false || c.rowActions
      ? [{
          key: 'actions', header: '', className: 'text-right',
          cell: (r: T) => (
            <div className="flex flex-wrap justify-end gap-1">
              {c.rowActions?.(r)}
              {c.canEdit !== false && <Button size="icon" variant="ghost" aria-label={`Edit ${c.singular}`} onClick={() => setEditing(r)}><Pencil className="h-4 w-4" /></Button>}
              {c.canDelete !== false && <Button size="icon" variant="ghost" aria-label={`Delete ${c.singular}`} onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4 text-danger" /></Button>}
            </div>
          ),
        } as Column<T>]
      : []),
  ];

  const exportCsv = () => {
    if (!c.exportColumns) return;
    const head = c.exportColumns.map((x) => x.header);
    downloadText(`${c.collection}.csv`, toCsv([head, ...visible.map((r) => c.exportColumns!.map((x) => x.value(r)))]));
  };

  const open = creating || editing !== null;
  return (
    <>
      <PageHeader
        title={c.plural}
        description={c.description}
        actions={<>
          {c.headerActions}
          {c.exportColumns && <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> Export CSV</Button>}
          {c.canCreate !== false && <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New {c.singular.toLowerCase()}</Button>}
        </>}
      />
      <DataTable<T>
        columns={columns}
        rows={visible}
        loading={loading}
        error={error}
        emptyTitle={rows.length ? `No ${c.plural.toLowerCase()} match your filters` : `No ${c.plural.toLowerCase()} yet`}
        emptyDescription={rows.length ? 'Try clearing the search or filters.' : c.canCreate !== false ? `Create the first ${c.singular.toLowerCase()} to get started.` : undefined}
        emptyAction={!rows.length && c.canCreate !== false ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New {c.singular.toLowerCase()}</Button> : undefined}
        toolbar={<>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input aria-label={`Search ${c.plural}`} className="pl-9" placeholder={`Search ${c.plural.toLowerCase()}…`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {c.filters?.map((f) => (
            <Select key={f.name} aria-label={f.label} className="w-auto min-w-36" value={filterValues[f.name] ?? ''} onChange={(e) => setFilterValues((s) => ({ ...s, [f.name]: e.target.value }))}>
              <option value="">{f.label}: all</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ))}
        </>}
      />
      <Dialog open={open} onClose={() => { setCreating(false); setEditing(null); }} size={c.dialogSize ?? 'lg'} title={editing ? `Edit ${c.singular.toLowerCase()}` : `New ${c.singular.toLowerCase()}`}>
        {open && <EntityForm key={editing?.id ?? 'new'} fields={c.fields} initial={editing} onSubmit={save} onCancel={() => { setCreating(false); setEditing(null); }} submitLabel={editing ? 'Save changes' : `Create ${c.singular.toLowerCase()}`} />}
      </Dialog>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} loading={busy} onConfirm={confirmDelete}
        title={`Delete ${c.singular.toLowerCase()}?`} message="This cannot be undone." />
    </>
  );
}
