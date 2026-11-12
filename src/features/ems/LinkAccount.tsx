import { useEffect, useState } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { StatusBadge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { candidatesFor, linkProblem, rolesIn, type LinkKind, type RecordLite, type UserLite } from '@/lib/linking';
import { linkAccount, planUnlink, unlinkAccount } from '@/services/linking';
import type { UnlinkPlan } from '@/lib/linking';
import { errorMessage } from '@/lib/utils';
import type { UserProfile } from '@/types/models';

const COLLECTION: Record<LinkKind, string> = { staff: C.staff, student: C.students, parent: C.parents };
const NOUN: Record<LinkKind, string> = { staff: 'staff member', student: 'learner', parent: 'parent / guardian' };

/** Link / unlink buttons for one record. Admins only (the rules enforce it too). */
export function LinkAccount({ kind, record, label, linkedUid }: { kind: LinkKind; record: { id: string }; label: string; linkedUid?: string }) {
  const { roles, uid: myUid } = useAuth();
  const toast = useToast();
  const allowed = roles.includes('super_admin') || roles.includes('admin');
  const [open, setOpen] = useState<'link' | 'unlink' | null>(null);
  const [q, setQ] = useState(''); const [showAll, setShowAll] = useState(false); const [pick, setPick] = useState('');
  const [plan, setPlan] = useState<UnlinkPlan | null>(null); const [busy, setBusy] = useState(false);
  const users = useCollection<UserProfile>(C.users, () => (open ? [] : null), open ? 'o' : 'c');
  const records = useCollection<RecordLite & Record<string, unknown>>(COLLECTION[kind], () => (open === 'link' ? [] : null), open === 'link' ? 'o' : 'c');
  const linkedUser = users.data.find((u) => u.id === linkedUid);
  useEffect(() => { if (open !== 'unlink' || !linkedUser) return; void planUnlink(kind, linkedUser as unknown as UserLite, linkedUser.id === myUid).then(setPlan).catch((e) => toast.error(errorMessage(e))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, linkedUser?.id]);
  if (!allowed) return null;
  const close = () => { setOpen(null); setQ(''); setPick(''); setPlan(null); setShowAll(false); };
  const list = candidatesFor(users.data as unknown as UserLite[], kind, records.data, q, showAll);
  const chosen = list.find((u) => u.id === pick);
  const problem = chosen ? linkProblem(chosen, { id: record.id }, kind, records.data) : null;
  const doLink = async () => {
    if (!chosen || problem) return;
    setBusy(true);
    try { await linkAccount(kind, record.id, chosen, label); toast.success(`${chosen.displayName} is now linked to ${label}.`); close(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const doUnlink = async () => {
    if (!linkedUser || !plan) return;
    setBusy(true);
    try { await unlinkAccount(kind, record.id, linkedUser as unknown as UserLite, plan); toast.success('Login unlinked. The account itself was kept.'); close(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      {linkedUid
        ? <Button size="icon" variant="ghost" aria-label={`Unlink login from ${label}`} onClick={() => setOpen('unlink')}><Link2Off className="h-4 w-4" /></Button>
        : <Button size="icon" variant="ghost" aria-label={`Link an existing login to ${label}`} onClick={() => setOpen('link')}><Link2 className="h-4 w-4" /></Button>}
      <Dialog open={open === 'link'} onClose={close} size="md" title={`Link an existing login to ${label}`} description={`Choose the account that belongs to this ${NOUN[kind]}. No new account is created.`}
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button loading={busy} disabled={!chosen || !!problem} onClick={() => void doLink()}>Link login</Button></>}>
        <Field label="Search by name or email">{(a) => <Input {...a} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing…" autoFocus />}</Field>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted"><input type="checkbox" className="accent-forest-700" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Also show logins that are already linked (they cannot be chosen)</label>
        <ul className="mt-3 max-h-64 divide-y divide-line overflow-auto rounded-md border border-line" role="listbox" aria-label="Logins">
          {users.loading && <li className="p-3 text-sm text-muted">Loading…</li>}
          {!users.loading && list.length === 0 && <li className="p-3 text-sm text-muted">No unlinked logins match. Create one with the key button instead.</li>}
          {list.slice(0, 60).map((u) => { const p = linkProblem(u, { id: record.id }, kind, records.data); return (
            <li key={u.id}><button type="button" role="option" aria-selected={pick === u.id} disabled={!!p} onClick={() => setPick(u.id)} className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${pick === u.id ? 'bg-forest-50' : ''} ${p ? 'opacity-50' : 'hover:bg-cream'}`}>
              <span><span className="block font-medium">{u.displayName}</span><span className="block text-xs text-muted">{u.email} · {rolesIn(u).join(', ')}</span></span>
              {p ? <span className="text-[11px] text-muted">linked</span> : <StatusBadge status={u.status ?? 'active'} />}</button></li>); })}
        </ul>
        {problem && <p className="mt-2 text-xs text-danger" role="alert">{problem}</p>}
      </Dialog>
      <Dialog open={open === 'unlink'} onClose={close} size="sm" title={`Unlink login from ${label}?`} description={linkedUser ? `${linkedUser.displayName} · ${linkedUser.email}` : ''}
        footer={<><Button variant="outline" onClick={close}>Cancel</Button><Button variant="danger" loading={busy} disabled={!plan || !!plan.block} onClick={() => void doUnlink()}>Unlink</Button></>}>
        {!plan && <p className="text-sm text-muted">Checking…</p>}
        {plan?.block && <p className="text-sm text-danger" role="alert">{plan.block}</p>}
        {plan && !plan.block && <div className="space-y-2 text-sm"><p>The account is <b>not deleted</b>. The link between this record and the login is removed.</p>{plan.warnings.map((w) => <p key={w} className="rounded bg-gold-100 p-2 text-xs">{w}</p>)}</div>}
      </Dialog>
    </>
  );
}
