import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/data';
import { Dialog, useToast } from '@/components/ui/overlay';
import { checkDelete, deleteRecord, type DeleteCheck, type RecordKind } from '@/services/records';
import { errorMessage } from '@/lib/utils';

const WORD: Record<RecordKind, string> = { student: 'student', parent: 'parent', staff: 'staff member', invoice: 'invoice' };

/**
 * "Delete permanently" for staff, parents, students and invoices. Shows exactly what will happen first
 * (dependencies, what is kept for accounting), then needs the word DELETE. The work is done by the secure backend.
 */
export function PurgeButton({ kind, id, onDone }: { kind: RecordKind; id: string; onDone?: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [chk, setChk] = useState<DeleteCheck | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const [login, setLogin] = useState(false);

  const start = async () => {
    setOpen(true); setChk(null); setTyped(''); setLogin(false); setLoading(true);
    try { setChk(await checkDelete(kind, id)); } catch (e) { toast.error(errorMessage(e)); setOpen(false); } finally { setLoading(false); }
  };
  const go = async () => {
    setBusy(true);
    try { const r = await deleteRecord(kind, id, { deleteLogin: login, confirm: typed.trim() }); toast.success(`Deleted. ${r.login}.`); setOpen(false); onDone?.(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <Button size="icon" variant="ghost" aria-label={`Delete ${WORD[kind]} permanently`} onClick={() => void start()}><Trash2 className="h-4 w-4 text-danger" /></Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="md" title={`Delete ${WORD[kind]} permanently`}
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} disabled={!chk || chk.blocked || typed.trim() !== 'DELETE'} onClick={() => void go()}>Delete permanently</Button></>}>
        {loading || !chk ? <Spinner /> : (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{chk.label}</p>
            <p className="text-muted">This cannot be undone. A restricted archive copy and an audit entry are kept by the system. Review what happens to related records:</p>
            <ul className="divide-y divide-line rounded border border-line">
              {chk.deps.map((d) => (
                <li key={d.key} className="flex items-start justify-between gap-3 p-2">
                  <span className={d.blocking && d.count ? 'text-danger' : ''}>{d.label}{d.note ? <span className="block text-xs text-muted">{d.note}</span> : null}</span>
                  <strong>{d.count}</strong>
                </li>))}
            </ul>
            {chk.blocked && <p className="rounded bg-red-50 p-2 text-danger">Resolve the items in red first (for example reassign or cancel the upcoming sessions), then try again.</p>}
            {chk.hasLogin && <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={login} onChange={(e) => setLogin(e.target.checked)} /><span>Also delete their login account. (If the person has another role, such as a teacher who is also a parent, only this role is removed.)</span></label>}
            <label className="block">Type <strong>DELETE</strong> to confirm<Input className="mt-1" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          </div>)}
      </Dialog>
    </>
  );
}
