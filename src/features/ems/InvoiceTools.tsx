import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { C } from '@/config/collections';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { alreadyInvoiced, ledgerSummary } from '@/lib/finance';
import { errorMessage, fmtMoney, todayISO } from '@/lib/utils';
import { fullName, generateInvoices, recordAdvancePayment } from '@/services/ems';
import type { ClassRoom, FeeStructure, Invoice, Student, StudentCredit, Term, WithId } from '@/types/models';

const label = (s: Student) => `${fullName(s)} (${s.studentNo}${s.className ? `, ${s.className}` : ''})`;
const active = (s: Student) => s.status === 'active';

/** Searchable learner picker: type a name or admission number, tap a result. */
function LearnerSearch({ students, onPick, exclude }: { students: WithId<Student>[]; onPick: (s: WithId<Student>) => void; exclude?: Set<string> }) {
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return [];
    return students.filter((s) => active(s) && !exclude?.has(s.id) && `${fullName(s)} ${s.studentNo}`.toLowerCase().includes(n)).slice(0, 8);
  }, [q, students, exclude]);
  return (
    <div>
      <Input placeholder="Search a learner by name or admission number…" value={q} onChange={(e) => setQ(e.target.value)} />
      {hits.length > 0 && <ul className="mt-1 divide-y divide-line rounded border border-line bg-white">{hits.map((s) => <li key={s.id}><button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-cream" onClick={() => { onPick(s); setQ(''); }}>{label(s)}</button></li>)}</ul>}
    </div>
  );
}

/** Invoices for a whole class, hand-picked learners, or a single learner, with a recipient preview. */
export function GenerateInvoicesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const structures = useCollection<FeeStructure>(C.feeStructures, () => [], 'all');
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const students = useCollection<Student>(C.students, () => [], 'all');
  const invoices = useCollection<Invoice>(C.invoices, () => [], 'all');
  const credits = useCollection<StudentCredit>(C.studentCredits, () => [], 'all');
  const [mode, setMode] = useState<'class' | 'picked'>('class');
  const [g, setG] = useState({ structureId: '', termId: '', classId: '', due: todayISO() });
  const [off, setOff] = useState<Set<string>>(new Set());        // class learners the office un-ticked
  const [picked, setPicked] = useState<WithId<Student>[]>([]);
  const [busy, setBusy] = useState(false);
  const st = structures.data.find((x) => x.id === g.structureId); const term = terms.data.find((x) => x.id === g.termId);
  const billed = useMemo(() => (st && term ? alreadyInvoiced(invoices.data, st, term.id) : new Set<string>()), [st, term, invoices.data]);
  const creditOf = (id: string) => ledgerSummary([], credits.data.filter((c) => c.studentId === id)).creditAvailable;
  const classList = students.data.filter((s) => active(s) && s.classId === g.classId).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const recipients = mode === 'class' ? classList.filter((s) => !off.has(s.id)) : picked;
  const toBill = recipients.filter((s) => !billed.has(s.id));

  const go = async () => {
    if (!st || !term) return toast.error('Choose a fee structure and a term.');
    if (toBill.length === 0) return toast.error('Nobody to bill: everyone selected already has this invoice.');
    setBusy(true);
    try {
      const r = await generateInvoices({ structure: st, students: toBill, termId: term.id, termName: `${term.sessionName ?? ''} ${term.name}`.trim(), dueDate: g.due });
      toast.success(`${r.created} invoice(s) created${r.skipped ? `, ${r.skipped} already existed` : ''}${r.credited ? `, NGN ${r.credited.toLocaleString('en-NG')} paid from advance payments` : ''}`);
      onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Generate invoices" description="Bill a whole class, chosen learners, or one learner. Learners who already paid in advance are credited automatically."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!toBill.length} onClick={() => void go()}>Create {toBill.length} invoice{toBill.length === 1 ? '' : 's'}</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fee category">{(a) => <Select {...a} value={g.structureId} onChange={(e) => setG({ ...g, structureId: e.target.value })}><option value="">Select…</option>{structures.data.map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.total, s.currency)}</option>)}</Select>}</Field>
          <Field label="Term">{(a) => <Select {...a} value={g.termId} onChange={(e) => setG({ ...g, termId: e.target.value })}><option value="">Select…</option>{terms.data.map((t) => <option key={t.id} value={t.id}>{t.sessionName} {t.name}</option>)}</Select>}</Field>
          <Field label="Due date">{(a) => <Input {...a} type="date" value={g.due} onChange={(e) => setG({ ...g, due: e.target.value })} />}</Field>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === 'class' ? 'primary' : 'outline'} onClick={() => setMode('class')}>A class</Button>
          <Button size="sm" variant={mode === 'picked' ? 'primary' : 'outline'} onClick={() => setMode('picked')}>Chosen learners</Button>
        </div>
        {mode === 'class' ? (
          <div className="space-y-2">
            <Field label="Class">{(a) => <Select {...a} value={g.classId} onChange={(e) => { setG({ ...g, classId: e.target.value }); setOff(new Set()); }}><option value="">Select…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            {classList.length > 0 && <p className="text-xs text-muted">Untick anyone who should not be billed. {off.size ? `${off.size} excluded.` : ''}</p>}
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded border border-line">
              {classList.map((s) => { const done = billed.has(s.id); const cr = creditOf(s.id); return (
                <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <input type="checkbox" disabled={done} checked={!done && !off.has(s.id)} onChange={() => setOff((o) => { const n = new Set(o); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                  <span className="flex-1">{fullName(s)} <span className="text-xs text-muted">{s.studentNo}</span></span>
                  {done ? <span className="text-xs text-muted">already invoiced</span> : cr > 0 ? <span className="text-xs text-forest-700">credit {fmtMoney(cr, 'NGN')}</span> : null}
                </li>); })}
            </ul>
          </div>
        ) : (
          <div className="space-y-2">
            <LearnerSearch students={students.data} onPick={(s) => setPicked((p) => (p.some((x) => x.id === s.id) ? p : [...p, s]))} exclude={new Set(picked.map((p) => p.id))} />
            <ul className="divide-y divide-line rounded border border-line">
              {picked.length === 0 ? <li className="px-3 py-2 text-sm text-muted">No learners chosen yet.</li> : picked.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-1.5 text-sm"><span className="flex-1">{label(s)}</span>
                  {billed.has(s.id) ? <span className="text-xs text-muted">already invoiced</span> : creditOf(s.id) > 0 ? <span className="text-xs text-forest-700">credit {fmtMoney(creditOf(s.id), 'NGN')}</span> : null}
                  <Button size="sm" variant="ghost" onClick={() => setPicked((p) => p.filter((x) => x.id !== s.id))}>Remove</Button></li>))}
            </ul>
          </div>
        )}
        {st && term && <p className="rounded bg-cream p-3 text-sm">{toBill.length} learner(s) will be billed {fmtMoney(st.total, st.currency)} each ({fmtMoney(st.total * toBill.length, st.currency)} total){recipients.length - toBill.length ? `; ${recipients.length - toBill.length} skipped (already invoiced)` : ''}.</p>}
      </div>
    </Dialog>
  );
}

/** Money a learner paid before an invoice existed (or in advance). It reconciles against the right invoice automatically. */
export function AdvancePaymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { profile } = useAuth();
  const structures = useCollection<FeeStructure>(C.feeStructures, () => [], 'all');
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const students = useCollection<Student>(C.students, () => [], 'all');
  const [who, setWho] = useState<WithId<Student> | null>(null);
  const [f, setF] = useState({ amount: '', method: 'cash' as StudentCredit['method'], reference: '', paidAt: todayISO(), structureId: '', termId: '', note: '' });
  const [busy, setBusy] = useState(false);
  const done = () => { setWho(null); setF({ ...f, amount: '', reference: '', note: '' }); onClose(); };
  const save = async () => {
    if (!who) return toast.error('Choose the learner.');
    const st = structures.data.find((x) => x.id === f.structureId); const term = terms.data.find((x) => x.id === f.termId);
    setBusy(true);
    try {
      const r = await recordAdvancePayment(who, { amount: Number(f.amount), method: f.method, reference: f.reference, paidAt: f.paidAt, by: profile?.displayName ?? '', currency: st?.currency ?? 'NGN', termId: term?.id, termName: term ? `${term.sessionName ?? ''} ${term.name}`.trim() : '', structureId: st?.id, structureName: st?.name, note: f.note });
      toast.success(`Receipt ${r.receiptNo}. ${r.applied ? `NGN ${r.applied.toLocaleString('en-NG')} applied to an existing invoice. ` : ''}${r.waiting ? `NGN ${r.waiting.toLocaleString('en-NG')} waits on the account and pays the invoice when it is generated.` : ''}`);
      done();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={onClose} size="md" title="Previous / advance payment" description="For learners who paid before their invoice was generated. Pick the fee category and term so the money pays the right invoice."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Record payment</Button></>}>
      <div className="space-y-4">
        {who ? <div className="flex items-center justify-between rounded border border-line p-2 text-sm"><span>{label(who)}</span><Button size="sm" variant="ghost" onClick={() => setWho(null)}>Change</Button></div> : <LearnerSearch students={students.data} onPick={setWho} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Fee category (optional)">{(a) => <Select {...a} value={f.structureId} onChange={(e) => setF({ ...f, structureId: e.target.value })}><option value="">Any</option>{structures.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
          <Field label="Term (optional)">{(a) => <Select {...a} value={f.termId} onChange={(e) => setF({ ...f, termId: e.target.value })}><option value="">Any</option>{terms.data.map((t) => <option key={t.id} value={t.id}>{t.sessionName} {t.name}</option>)}</Select>}</Field>
          <Field label="Amount (NGN)" required>{(a) => <Input {...a} type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />}</Field>
          <Field label="Date paid" required>{(a) => <Input {...a} type="date" value={f.paidAt} onChange={(e) => setF({ ...f, paidAt: e.target.value })} />}</Field>
          <Field label="Method">{(a) => <Select {...a} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value as StudentCredit['method'] })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="pos">POS</option></Select>}</Field>
          <Field label="Reference">{(a) => <Input {...a} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />}</Field>
        </div>
        <Field label="Note (optional)">{(a) => <Textarea {...a} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />}</Field>
      </div>
    </Dialog>
  );
}
