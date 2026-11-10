import { useEffect, useMemo, useState } from 'react';
import { where, orderBy, limit } from 'firebase/firestore';
import { Printer, Receipt as ReceiptIcon, Wallet } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { DataTable } from '@/components/common/DataTable';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, StatusBadge, Spinner, EmptyState, Td, Th, TableWrap } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { BRAND } from '@/config/brand';
import { assignableRoles, can, rolesOf, ROLE_LABELS, ALL_ROLES, type Role } from '@/config/permissions';
import { useSettings } from '@/hooks/useSettings';
import { batchSet, patchDoc } from '@/services/db';
import { generateInvoices, fullName, recordPayment } from '@/services/ems';
import { createAccount, randomPassword } from '@/services/accounts';
import { audit } from '@/services/audit';
import { downloadText, errorMessage, fmtDate, fmtMoney, todayISO, toDate } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import { invoiceTotal } from '@/lib/finance';
import type { AttendanceRecord, AttendanceStatus, ClassRoom, FeeStructure, Invoice, Payment, Student, Term, UserProfile, WithId } from '@/types/models';
import { classRef } from './refs';
import { LinkedPeopleDialog } from './people';

type Row = Record<string, unknown> & { id: string };
export interface SchoolSettings { schoolName: string; currency: string; address: string; paymentNote: string; reportFooter: string; caMax: number; examMax: number }
export const SCHOOL_DEFAULTS: SchoolSettings = { schoolName: BRAND.name, currency: 'NGN', address: BRAND.location, paymentNote: '', reportFooter: '', caMax: 40, examMax: 60 };
export const useSchool = () => useSettings<SchoolSettings>('school', SCHOOL_DEFAULTS);

/* -------------------------------------------------------------- attendance */
const STATUSES: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

export function AttendancePage() {
  const { role, profile } = useAuth();
  const toast = useToast();
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const [tab, setTab] = useState<'mark' | 'report'>('mark');
  const [classId, setClassId] = useState('');
  const [date, setDate] = useState(todayISO());
  const students = useCollection<Student>(C.students, () => (classId ? [where('classId', '==', classId)] : null), classId);
  const att = useCollection<AttendanceRecord>(C.attendance, () => (classId ? [where('classId', '==', classId)] : null), classId);
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(todayISO().slice(0, 8) + '01');
  const [to, setTo] = useState(todayISO());
  const active = useMemo(() => students.data.filter((s) => s.status === 'active').sort((a, b) => a.lastName.localeCompare(b.lastName)), [students.data]);
  const write = can(role, 'attendance.write');

  useEffect(() => {
    const m: Record<string, AttendanceStatus> = {};
    att.data.filter((a) => a.date === date).forEach((a) => { m[a.studentId] = a.status; });
    setMarks(m);
  }, [att.data, date, classId]);

  const save = async () => {
    setBusy(true);
    try {
      await batchSet(active.filter((s) => marks[s.id]).map((s) => ({
        col: C.attendance, id: `${date}_${s.id}`, merge: false,
        data: { date, classId, studentId: s.id, studentName: fullName(s), studentUid: s.studentUid ?? '', parentUids: s.parentUids ?? [], status: marks[s.id], note: '', markedBy: profile?.displayName ?? '' } satisfies AttendanceRecord,
      })));
      toast.success('Attendance saved');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const summary = useMemo(() => active.map((s) => {
    const recs = att.data.filter((a) => a.studentId === s.id && a.date >= from && a.date <= to);
    const c = (st: AttendanceStatus) => recs.filter((r) => r.status === st).length;
    const days = recs.length;
    return { id: s.id, name: fullName(s), present: c('present'), absent: c('absent'), late: c('late'), excused: c('excused'), days, rate: days ? Math.round(((c('present') + c('late')) / days) * 100) : 0 };
  }), [active, att.data, from, to]);

  return (
    <>
      <PageHeader title="Attendance" description="Daily class attendance and summaries." actions={<><Button size="sm" variant={tab === 'mark' ? 'primary' : 'outline'} onClick={() => setTab('mark')}>Mark</Button><Button size="sm" variant={tab === 'report' ? 'primary' : 'outline'} onClick={() => setTab('report')}>Reports</Button></>} />
      <Card className="mb-4"><CardBody className="flex flex-wrap items-end gap-3">
        <Field label="Class" className="min-w-48">{(a) => <Select {...a} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        {tab === 'mark' ? <Field label="Date">{(a) => <Input {...a} type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />}</Field> : <>
          <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field><Field label="To">{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field></>}
      </CardBody></Card>
      {!classId ? <Card><EmptyState title="Choose a class" description="Select a class to mark or review attendance." /></Card> : students.loading ? <Spinner /> : tab === 'mark' ? (
        <Card><CardHeader title={`${fmtDate(date)} · ${active.length} students`} action={write ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setMarks(Object.fromEntries(active.map((s) => [s.id, 'present'])))}>All present</Button><Button size="sm" loading={busy} onClick={() => void save()}>Save attendance</Button></div> : undefined} />
          {active.length === 0 ? <EmptyState title="No active students in this class" /> : <ul className="divide-y divide-line">{active.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"><span className="font-medium">{fullName(s)}</span>
              <div role="radiogroup" aria-label={`Attendance for ${fullName(s)}`} className="flex gap-1">{STATUSES.map((st) => (
                <button key={st} role="radio" aria-checked={marks[s.id] === st} disabled={!write} onClick={() => setMarks((m) => ({ ...m, [s.id]: st }))}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium capitalize ${marks[s.id] === st ? (st === 'present' ? 'border-ok bg-ok-bg text-ok' : st === 'absent' ? 'border-danger bg-danger-bg text-danger' : 'border-gold-400 bg-gold-50 text-gold-600') : 'border-line text-muted hover:bg-cream'}`}>{st}</button>))}</div></li>))}</ul>}
        </Card>
      ) : (
        <Card><CardHeader title="Attendance summary" action={<div className="no-print flex gap-2"><Button size="sm" variant="outline" onClick={() => downloadText(`attendance_${from}_${to}.csv`, toCsv([['Student', 'Present', 'Absent', 'Late', 'Excused', 'Days', 'Rate %'], ...summary.map((r) => [r.name, r.present, r.absent, r.late, r.excused, r.days, r.rate])]))}>Download CSV</Button><Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / PDF</Button></div>} />
          <TableWrap><thead><tr><Th>Student</Th><Th>Present</Th><Th>Absent</Th><Th>Late</Th><Th>Excused</Th><Th>Days</Th><Th>Rate</Th></tr></thead>
            <tbody>{summary.map((r) => <tr key={r.id}><Td className="font-medium">{r.name}</Td><Td>{r.present}</Td><Td>{r.absent}</Td><Td>{r.late}</Td><Td>{r.excused}</Td><Td>{r.days}</Td><Td>{r.rate}%</Td></tr>)}</tbody></TableWrap></Card>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- finance */
export function FeeStructuresPage() {
  const { role } = useAuth();
  const w = can(role, 'finance.write');
  const school = useSchool();
  const parseItems = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [label, amt] = l.split('|').map((s) => s.trim());
    const amount = Number((amt ?? '').replace(/[^0-9.]/g, ''));
    if (!label || Number.isNaN(amount)) throw new Error(`Invalid line: “${l}”. Use  Label | amount`);
    return { label, amount };
  });
  return <CrudPage config={{
    collection: C.feeStructures, singular: 'Fee structure', plural: 'Fee structures', description: 'Reusable fee schedules used to generate invoices.', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true, placeholder: 'JSS 1 — Term fees' }, classRef('classId', 'className', false),
      { name: 'itemsText', label: 'Fee items', type: 'textarea', required: true, hint: 'One per line:  Tuition | 150000', placeholder: 'Tuition | 150000\nBooks | 25000' }, { name: 'currency', label: 'Currency', type: 'text', defaultValue: school.currency }],
    beforeSave: (p) => { const items = parseItems(String(p.itemsText)); const { itemsText, ...rest } = p; void itemsText; return { ...rest, items, total: invoiceTotal(items), currency: String(p.currency || school.currency), itemsText: items.map((i) => `${i.label} | ${i.amount}`).join('\n') }; },
    columns: [{ key: 'n', header: 'Structure', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'c', header: 'Class', cell: (r: Row & { className?: string }) => r.className || 'All' }, { key: 'i', header: 'Items', cell: (r: Row & { items?: unknown[] }) => (r.items ?? []).length }, { key: 't', header: 'Total', cell: (r: Row & { total?: number; currency?: string }) => fmtMoney(r.total ?? 0, r.currency) }],
    searchKeys: ['name', 'className'],
  } as CrudConfig<Row>} />;
}

export function ReceiptView({ payment, onClose }: { payment: WithId<Payment> | null; onClose: () => void }) {
  const school = useSchool();
  return (
    <Dialog open={!!payment} onClose={onClose} size="md" title="Payment receipt" footer={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>}>
      {payment && (
        <div className="print-area space-y-4 text-sm">
          <div className="flex items-center gap-3 border-b border-line pb-3"><img src={BRAND.logo} alt="" className="h-12 w-12" /><div><p className="font-heading font-semibold text-forest-700">{school.schoolName}</p><p className="text-xs text-muted">{school.address}</p></div></div>
          <dl className="grid grid-cols-2 gap-3"><div><dt className="text-xs text-muted">Receipt no.</dt><dd className="font-medium">{payment.receiptNo}</dd></div><div><dt className="text-xs text-muted">Date</dt><dd>{fmtDate(payment.paidAt)}</dd></div>
            <div><dt className="text-xs text-muted">Student</dt><dd>{payment.studentName}</dd></div><div><dt className="text-xs text-muted">Invoice</dt><dd>{payment.invoiceNo}</dd></div>
            <div><dt className="text-xs text-muted">Method</dt><dd className="capitalize">{payment.method.replace('_', ' ')}</dd></div><div><dt className="text-xs text-muted">Reference</dt><dd>{payment.reference || '—'}</dd></div></dl>
          <p className="rounded bg-cream p-4 text-center font-heading text-2xl font-semibold text-forest-700">{fmtMoney(payment.amount, payment.currency)}</p>
          <p className="text-xs text-muted">Recorded by {payment.recordedBy}. This receipt is computer generated.</p>
        </div>)}
    </Dialog>
  );
}

export function InvoicesPage() {
  const { role, profile } = useAuth();
  const toast = useToast();
  const w = can(role, 'finance.write');
  const school = useSchool();
  const structures = useCollection<FeeStructure>(C.feeStructures, () => [], 'all');
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const payments = useCollection<Payment>(C.payments, () => [], 'all');
  const [gen, setGen] = useState(false);
  const [g, setG] = useState({ structureId: '', termId: '', classId: '', due: todayISO() });
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState<(WithId<Invoice> & Record<string, unknown>) | null>(null);
  const [p, setP] = useState({ amount: '', method: 'cash' as Payment['method'], reference: '', paidAt: todayISO() });
  const [receipt, setReceipt] = useState<WithId<Payment> | null>(null);

  const doGenerate = async () => {
    const st = structures.data.find((x) => x.id === g.structureId); const term = terms.data.find((x) => x.id === g.termId);
    if (!st || !term || !g.classId) return toast.error('Choose a fee structure, term and class.');
    setBusy(true);
    try {
      const { listDocs } = await import('@/services/db');
      const studs = (await listDocs<Student>(C.students, [where('classId', '==', g.classId)])).filter((s) => s.status === 'active');
      const n = await generateInvoices({ structure: st, students: studs, termId: term.id, termName: `${term.sessionName ?? ''} ${term.name}`.trim(), dueDate: g.due });
      toast.success(`${n} invoice(s) created${n < studs.length ? ` (${studs.length - n} already existed)` : ''}`); setGen(false);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const doPay = async () => {
    if (!pay) return;
    setBusy(true);
    try { const r = await recordPayment(pay, { amount: Number(p.amount), method: p.method, reference: p.reference, paidAt: p.paidAt, by: profile?.displayName ?? '' }); toast.success(`Payment recorded — ${r}`); setPay(null); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const config: CrudConfig<WithId<Invoice> & Record<string, unknown>> = {
    collection: C.invoices, singular: 'Invoice', plural: 'Invoices', description: `Student invoices in ${school.currency}. Online gateway: not configured — payments are recorded manually.`, fields: [], canCreate: false, canEdit: false, canDelete: false,
    columns: [
      { key: 'n', header: 'Invoice', primary: true, cell: (r) => <div><p className="font-medium">{r.invoiceNo}</p><p className="text-xs text-muted">{r.studentName}</p></div> }, { key: 't', header: 'Term', cell: (r) => r.termName ?? '—' },
      { key: 'a', header: 'Total', cell: (r) => fmtMoney(r.total, r.currency) }, { key: 'p', header: 'Paid', cell: (r) => fmtMoney(r.paid, r.currency) }, { key: 'b', header: 'Balance', cell: (r) => <span className={r.balance > 0 ? 'font-medium text-danger' : ''}>{fmtMoney(r.balance, r.currency)}</span> },
      { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Due', cell: (r) => fmtDate(r.dueDate) },
    ],
    searchKeys: ['invoiceNo', 'studentName', 'termName'], sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    filters: [{ name: 'status', label: 'Status', options: ['unpaid', 'partial', 'paid', 'overdue', 'cancelled'].map((v) => ({ value: v, label: v })) }],
    exportColumns: [{ header: 'Invoice', value: (r) => r.invoiceNo }, { header: 'Student', value: (r) => r.studentName }, { header: 'Total', value: (r) => r.total }, { header: 'Paid', value: (r) => r.paid }, { header: 'Balance', value: (r) => r.balance }, { header: 'Status', value: (r) => r.status }],
    headerActions: w ? <Button variant="gold" onClick={() => setGen(true)}>Generate invoices</Button> : undefined,
    rowActions: (r) => (<>
      {w && r.balance > 0 && r.status !== 'cancelled' && <Button size="sm" variant="outline" onClick={() => { setPay(r); setP({ amount: String(r.balance), method: 'cash', reference: '', paidAt: todayISO() }); }}><Wallet className="h-4 w-4" /> Pay</Button>}
      {payments.data.filter((x) => x.invoiceId === r.id).slice(-1).map((x) => <Button key={x.id} size="icon" variant="ghost" aria-label="Latest receipt" onClick={() => setReceipt(x)}><ReceiptIcon className="h-4 w-4" /></Button>)}
      {w && r.status !== 'paid' && r.status !== 'cancelled' && r.paid === 0 && <Button size="sm" variant="ghost" onClick={() => { void patchDoc(C.invoices, r.id, { status: 'cancelled' }).then(() => audit('invoice.cancel', `invoices/${r.id}`)); }}>Cancel</Button>}
    </>),
  };
  return (
    <>
      <CrudPage config={config} />
      <Dialog open={gen} onClose={() => setGen(false)} title="Generate invoices" description="Creates one invoice per active student in the class (existing ones are skipped)." size="sm" footer={<><Button variant="outline" onClick={() => setGen(false)}>Cancel</Button><Button loading={busy} onClick={() => void doGenerate()}>Generate</Button></>}>
        <div className="space-y-4">
          <Field label="Fee structure">{(a) => <Select {...a} value={g.structureId} onChange={(e) => setG({ ...g, structureId: e.target.value })}><option value="">Select…</option>{structures.data.map((s) => <option key={s.id} value={s.id}>{s.name} — {fmtMoney(s.total, s.currency)}</option>)}</Select>}</Field>
          <Field label="Term">{(a) => <Select {...a} value={g.termId} onChange={(e) => setG({ ...g, termId: e.target.value })}><option value="">Select…</option>{terms.data.map((t) => <option key={t.id} value={t.id}>{t.sessionName} {t.name}</option>)}</Select>}</Field>
          <Field label="Class">{(a) => <Select {...a} value={g.classId} onChange={(e) => setG({ ...g, classId: e.target.value })}><option value="">Select…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Due date">{(a) => <Input {...a} type="date" value={g.due} onChange={(e) => setG({ ...g, due: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={!!pay} onClose={() => setPay(null)} title="Record payment" description={pay ? `${pay.invoiceNo} · balance ${fmtMoney(pay.balance, pay.currency)}` : ''} size="sm" footer={<><Button variant="outline" onClick={() => setPay(null)}>Cancel</Button><Button loading={busy} onClick={() => void doPay()}>Record payment</Button></>}>
        <div className="space-y-4">
          <Field label="Amount" required>{(a) => <Input {...a} type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} />}</Field>
          <Field label="Method">{(a) => <Select {...a} value={p.method} onChange={(e) => setP({ ...p, method: e.target.value as Payment['method'] })}><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="pos">POS</option></Select>}</Field>
          <Field label="Reference">{(a) => <Input {...a} value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} />}</Field>
          <Field label="Date paid">{(a) => <Input {...a} type="date" value={p.paidAt} onChange={(e) => setP({ ...p, paidAt: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <ReceiptView payment={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

export function PaymentsPage() {
  const [receipt, setReceipt] = useState<WithId<Payment> | null>(null);
  return (
    <>
      <CrudPage config={{
        collection: C.payments, singular: 'Payment', plural: 'Payments', description: 'Append-only payment ledger. Corrections require a Super Administrator.', canCreate: false, canEdit: false, canDelete: false,
        columns: [{ key: 'r', header: 'Receipt', primary: true, cell: (r: WithId<Payment> & Row) => <div><p className="font-medium">{r.receiptNo}</p><p className="text-xs text-muted">{r.studentName}</p></div> }, { key: 'a', header: 'Amount', cell: (r: WithId<Payment> & Row) => fmtMoney(r.amount, r.currency) }, { key: 'm', header: 'Method', cell: (r: WithId<Payment> & Row) => r.method.replace('_', ' ') }, { key: 'd', header: 'Date', cell: (r: WithId<Payment> & Row) => fmtDate(r.paidAt) }, { key: 'by', header: 'Recorded by', cell: (r: WithId<Payment> & Row) => r.recordedBy }],
        searchKeys: ['receiptNo', 'studentName', 'invoiceNo', 'reference'], sort: (a, b) => String(b.paidAt).localeCompare(String(a.paidAt)),
        exportColumns: [{ header: 'Receipt', value: (r: WithId<Payment> & Row) => r.receiptNo }, { header: 'Student', value: (r: WithId<Payment> & Row) => r.studentName }, { header: 'Amount', value: (r: WithId<Payment> & Row) => r.amount }, { header: 'Method', value: (r: WithId<Payment> & Row) => r.method }, { header: 'Date', value: (r: WithId<Payment> & Row) => r.paidAt }],
        rowActions: (r: WithId<Payment> & Row) => <Button size="icon" variant="ghost" aria-label="View receipt" onClick={() => setReceipt(r)}><ReceiptIcon className="h-4 w-4" /></Button>,
      } as CrudConfig<WithId<Payment> & Row>} />
      <ReceiptView payment={receipt} onClose={() => setReceipt(null)} />
    </>
  );
}

/* ---------------------------------------------------------- users & audit */
export function UsersPage() {
  const { roles: myRoles, uid: myUid } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ email: string; name: string; roles: Role[] }>({ email: '', name: '', roles: ['teacher'] });
  const [created, setCreated] = useState<{ email: string; pw: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<WithId<UserProfile> | null>(null);
  const [linksFor, setLinksFor] = useState<string | null>(null);
  const [sel, setSel] = useState<Role[]>([]);
  const [primary, setPrimary] = useState<Role>('teacher');
  const assignable = assignableRoles(myRoles);
  const toggle = (list: Role[], r: Role) => (list.includes(r) ? list.filter((x) => x !== r) : [...list, r]);

  const create = async () => {
    if (!f.email || !f.name) return toast.error('Name and email are required.');
    if (f.roles.length === 0) return toast.error('Choose at least one role.');
    setBusy(true);
    try { const pw = randomPassword(); await createAccount({ email: f.email, password: pw, displayName: f.name, role: f.roles[0]!, extraRoles: f.roles.slice(1) }); setCreated({ email: f.email, pw }); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const openEdit = (u: WithId<UserProfile>) => { const r = rolesOf(u); setEdit(u); setSel(r); setPrimary(r.includes(u.role) ? u.role : (r[0] ?? 'teacher')); };
  /** Roles this admin may not add/remove on this person (top tier unless super admin). */
  const locked = (r: Role) => !assignable.includes(r);
  const saveRoles = async () => {
    if (!edit) return;
    if (sel.length === 0) return toast.error('A person needs at least one role.');
    const before = rolesOf(edit);
    const added = sel.filter((r) => !before.includes(r)); const removed = before.filter((r) => !sel.includes(r));
    if (edit.id === myUid && removed.length) return toast.error('You cannot remove your own roles. Ask another Super Administrator.');
    setBusy(true);
    try {
      const prim = sel.includes(primary) ? primary : sel[0]!;
      await patchDoc(C.users, edit.id, { roles: sel, role: prim });
      if (added.length) void audit('role.assign', `users/${edit.id}`, `${edit.email}: +${added.join(', ')}`);
      if (removed.length) void audit('role.remove', `users/${edit.id}`, `${edit.email}: -${removed.join(', ')}`);
      toast.success('Roles updated. They apply at the person\'s next page load.'); setEdit(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <CrudPage config={{
        collection: C.users, singular: 'User', plural: 'Users & access', description: 'One login per person, with one or more roles. Suspending an account blocks all access immediately (enforced by security rules).', canCreate: false, canDelete: false, auditActions: true,
        fields: [{ name: 'displayName', label: 'Name', type: 'text', required: true }, { name: 'status', label: 'Status', type: 'select', required: true, options: ['active', 'suspended', 'pending'].map((v) => ({ value: v, label: v })) }, { name: 'phone', label: 'Phone', type: 'tel' }],
        columns: [{ key: 'n', header: 'User', primary: true, cell: (r: WithId<UserProfile> & Row) => <div><p className="font-medium">{r.displayName}</p><p className="text-xs text-muted">{r.loginType === 'username' && r.username ? `Username: ${r.username}` : r.email}</p></div> }, { key: 'r', header: 'Roles', cell: (r: WithId<UserProfile> & Row) => <span className="flex flex-wrap gap-1">{rolesOf(r).map((x) => <Badge key={x}>{ROLE_LABELS[x]}</Badge>)}</span> }, { key: 's', header: 'Status', cell: (r: WithId<UserProfile> & Row) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Created', cell: (r: Row) => fmtDate(r.createdAt) }],
        searchKeys: ['displayName', 'email', 'role'], filters: [{ name: 'role', label: 'Primary role', options: ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) }, { name: 'status', label: 'Status', options: ['active', 'suspended', 'pending'].map((v) => ({ value: v, label: v })) }],
        rowActions: (r: Row) => (
          <>
            {typeof r.studentId === 'string' && r.studentId && <Button size="sm" variant="outline" onClick={() => setLinksFor(r.studentId as string)}>Links</Button>}
            {assignable.length ? <Button size="sm" variant="outline" onClick={() => openEdit(r as unknown as WithId<UserProfile>)}>Roles</Button> : null}
          </>
        ),
        headerActions: <Button onClick={() => { setOpen(true); setCreated(null); setF({ email: '', name: '', roles: ['teacher'] }); }}>Create account</Button>,
      } as CrudConfig<Row>} />

      <LinkedPeopleDialog studentId={linksFor} onClose={() => setLinksFor(null)} />
      <Dialog open={open} onClose={() => setOpen(false)} title="Create account" size="sm" footer={created ? <Button onClick={() => setOpen(false)}>Done</Button> : <><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={() => void create()}>Create</Button></>}>
        {created ? <div className="space-y-2 text-sm"><p className="text-ok">Account created.</p><p className="rounded bg-cream p-3 font-mono text-[13px]">{created.email}<br />{created.pw}</p><p className="text-xs text-muted">Shown once — share securely.</p></div> : (
          <div className="space-y-4"><Field label="Full name" required>{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Email" required>{(a) => <Input {...a} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <fieldset><legend className="mb-1 text-sm font-medium">Roles</legend><p className="mb-2 text-xs text-muted">The first role you tick is the starting workspace. One person can hold several (e.g. Teacher + Parent).</p>
              <div className="grid gap-1.5">{assignable.map((r) => <Checkbox key={r} label={ROLE_LABELS[r]} checked={f.roles.includes(r)} onChange={() => setF({ ...f, roles: toggle(f.roles, r) })} />)}</div></fieldset></div>)}
      </Dialog>

      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Manage roles" description={edit ? `${edit.displayName} · ${edit.email}` : ''} size="sm" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => void saveRoles()}>Save roles</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-1.5">{ALL_ROLES.map((r) => <Checkbox key={r} label={<span>{ROLE_LABELS[r]}{locked(r) && <span className="ml-1 text-xs text-muted">(Super Administrator only)</span>}</span>} checked={sel.includes(r)} disabled={locked(r)} onChange={() => setSel(toggle(sel, r))} />)}</div>
          <Field label="Default workspace">{(a) => <Select {...a} value={sel.includes(primary) ? primary : (sel[0] ?? '')} onChange={(e) => setPrimary(e.target.value as Role)}>{sel.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>}</Field>
          <p className="text-xs text-muted">Role changes are enforced by the database rules and recorded in the audit log.</p>
        </div>
      </Dialog>
    </>
  );
}

export function AuditPage() {
  const { data, loading, error } = useCollection<{ action: string; target: string; detail?: string; actorName: string; at: unknown }>(C.auditLogs, () => [orderBy('at', 'desc'), limit(200)], 'recent');
  return (
    <>
      <PageHeader title="Audit log" description="Most recent 200 sensitive actions. Entries cannot be edited or deleted." />
      <DataTable rows={data} loading={loading} error={error} columns={[{ key: 'w', header: 'When', primary: true, cell: (r) => fmtDate(r.at, true) }, { key: 'a', header: 'Actor', cell: (r) => r.actorName }, { key: 'x', header: 'Action', cell: (r) => <code className="text-xs">{r.action}</code> }, { key: 't', header: 'Target', cell: (r) => <span className="text-xs">{r.target}</span> }, { key: 'd', header: 'Detail', cell: (r) => r.detail }]} />
    </>
  );
}

export function AdmissionsInbox() {
  const { role, profile } = useAuth();
  const toast = useToast();
  const [note, setNote] = useState<Row | null>(null);
  const convert = async (r: Row) => {
    try {
      const { createDoc } = await import('@/services/db'); const { nextStudentNo } = await import('@/services/counters');
      const parts = String(r.studentName).trim().split(/\s+/);
      const id = await createDoc(C.students, { studentNo: await nextStudentNo(), firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') || '-', gender: String(r.gender ?? '').toLowerCase(), dob: r.dob ?? '', classId: '', className: String(r.classApplied ?? ''), admissionStatus: 'applicant', status: 'active', guardianPhone: r.parentPhone ?? '', address: r.address ?? '', studentUid: '', parentUids: [], parentIds: [] });
      await patchDoc(C.admissionEnquiries, r.id, { status: 'converted', studentId: id }); void audit('admission.convert', `admissionEnquiries/${r.id}`, id);
      toast.success('Applicant record created — allocate a class under EMS → Students');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  void profile;
  const can_ = can(role, 'students.write');
  return (
    <>
      <CrudPage config={{
        collection: C.admissionEnquiries, singular: 'Admission enquiry', plural: 'Admission enquiries', description: 'Applications submitted from the public Admissions page.', canCreate: false, canDelete: false, auditActions: true,
        fields: [{ name: 'status', label: 'Status', type: 'select', required: true, options: ['new', 'contacted', 'admitted', 'declined', 'converted'].map((v) => ({ value: v, label: v })) }, { name: 'internalNote', label: 'Internal note', type: 'textarea' }],
        columns: [{ key: 'n', header: 'Learner', primary: true, cell: (r: Row & { studentName: string; classApplied?: string }) => <div><p className="font-medium">{r.studentName}</p><p className="text-xs text-muted">{r.classApplied}</p></div> }, { key: 'p', header: 'Parent', cell: (r: Row & { parentName?: string; parentPhone?: string }) => <div><p>{r.parentName}</p><a className="text-xs text-forest-500 underline" href={`tel:${r.parentPhone}`}>{r.parentPhone}</a></div> }, { key: 'm', header: 'Mode', cell: (r: Row & { mode?: string }) => r.mode || '—' }, { key: 's', header: 'Status', cell: (r: Row & { status: string }) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Received', cell: (r: Row) => fmtDate(r.createdAt, true) }],
        searchKeys: ['studentName', 'parentName', 'parentPhone', 'classApplied'], sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
        filters: [{ name: 'status', label: 'Status', options: ['new', 'contacted', 'admitted', 'declined', 'converted'].map((v) => ({ value: v, label: v })) }],
        rowActions: (r: Row) => (<><Button size="sm" variant="ghost" onClick={() => setNote(r)}>Details</Button>{can_ && r.status !== 'converted' && <Button size="sm" variant="outline" onClick={() => void convert(r)}>Create student</Button>}</>),
      } as CrudConfig<Row>} />
      <Dialog open={!!note} onClose={() => setNote(null)} title="Enquiry details" description={String(note?.studentName ?? '')}>
        {note && <dl className="grid grid-cols-2 gap-3 text-sm">{[['Class', note.classApplied], ['Gender', note.gender], ['DOB', note.dob], ['Mode', note.mode], ['Schedule', note.schedule], ['Parent', note.parentName], ['Phone', note.parentPhone], ['Email', note.parentEmail], ['Address', note.address]].map(([k, v]) => <div key={String(k)}><dt className="text-xs text-muted">{String(k)}</dt><dd>{String(v || '—')}</dd></div>)}
          <div className="col-span-2"><dt className="text-xs text-muted">Programmes</dt><dd>{(note.programmes as string[] | undefined)?.join(', ') || '—'}</dd></div><div className="col-span-2"><dt className="text-xs text-muted">Notes</dt><dd><Textarea readOnly value={String(note.notes ?? '')} /></dd></div></dl>}
      </Dialog>
    </>
  );
}
