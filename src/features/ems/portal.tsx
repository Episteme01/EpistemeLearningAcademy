import { SecureAvatar } from '@/components/common/SecureAvatar';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Receipt as ReceiptIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { EmptyState, Progress, Spinner, StatusBadge, Tabs, TableWrap, Td, Th } from '@/components/ui/data';
import { Dialog } from '@/components/ui/overlay';
import { EntityForm } from '@/components/common/EntityForm';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { can } from '@/config/permissions';
import { fmtDate, fmtMoney, errorMessage, toDate } from '@/lib/utils';
import { fullName } from '@/services/ems';
import { setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { audit } from '@/services/audit';
import { payInvoiceOnline, paystackOn } from '@/services/paystack';
import { ChildHomework } from '@/features/lms/homework';
import { ReportCardSheet } from './results';
import { ReceiptView, SCHOOL_DEFAULTS, useSchool } from './operations';
import { AdmissionLetterDialog, canPrintAdmissionLetter } from './AdmissionLetter';
import type { AttendanceRecord, ClassRoom, CourseEnrollment, Invoice, Payment, ReportCard, ResultRecord, Student, Term, WithId } from '@/types/models';

const FOREST = '#0B3D2E'; const GOLD = '#C8A45A';

/* ----------------------------------------------------------- child portal */
type Tab = 'profile' | 'results' | 'attendance' | 'fees' | 'learning' | 'homework';

export function ChildPortal({ student }: { student: WithId<Student> }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('results');
  const sid = student.id;
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const { role, uid } = useAuth();
  // Security rules can only prove a query is allowed when it carries the ownership filter,
  // so parents/students always add their own uid (and 'approved' for results).
  const viewer = role === 'parent' ? 'parent' : role === 'student' ? 'student' : 'staff';
  const own = viewer === 'parent' ? [where('parentUids', 'array-contains', uid ?? '')] : viewer === 'student' ? [where('studentUid', '==', uid ?? '')] : [];
  const approved = viewer === 'staff' ? [] : [where('status', '==', 'approved')];
  const k = `${sid}${viewer}${uid}`;
  const results = useCollection<ResultRecord>(C.results, () => [where('studentId', '==', sid), ...own, ...approved], k);
  const cards = useCollection<ReportCard>(C.reportCards, () => [where('studentId', '==', sid), ...own, ...approved], k);
  const att = useCollection<AttendanceRecord>(C.attendance, () => [where('studentId', '==', sid), ...own], k);
  const inv = useCollection<Invoice>(C.invoices, () => [where('studentId', '==', sid), ...own], k);
  const pay = useCollection<Payment>(C.payments, () => [where('studentId', '==', sid), ...own], k);
  const enr = useCollection<CourseEnrollment>(C.courseEnrollments, () => (student.studentUid ? [where('uid', '==', student.studentUid), ...(viewer === 'parent' ? [where('parentUids', 'array-contains', uid ?? '')] : [])] : null), k + student.studentUid);
  const history = useCollection<{ text: string; by: string; at: unknown }>(`${C.students}/${sid}/history`, () => (viewer === 'staff' ? [] : null), k);
  const [card, setCard] = useState<WithId<ReportCard> | null>(null);
  const [receipt, setReceipt] = useState<WithId<Payment> | null>(null);
  const [letter, setLetter] = useState(false);
  const [payingId, setPayingId] = useState('');
  const payOnline = async (invoiceId: string, part = false) => {
    let amount: number | undefined;
    if (part) { const v = window.prompt('How much do you want to pay now (NGN)?'); if (!v) return; amount = Number(v.replace(/,/g, '')); if (!(amount > 0)) return toast.error('Enter a valid amount.'); }
    setPayingId(invoiceId);
    try { await payInvoiceOnline(invoiceId, amount); } catch (e) { toast.error(errorMessage(e)); setPayingId(''); }
  };
  const attSum = useMemo(() => { const c = (s: string) => att.data.filter((a) => a.status === s).length; const d = att.data.length; return { present: c('present'), absent: c('absent'), late: c('late'), excused: c('excused'), rate: d ? Math.round(((c('present') + c('late')) / d) * 100) : 0 }; }, [att.data]);
  const owing = inv.data.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.balance, 0);
  const termName = (id: string) => { const t = terms.data.find((x) => x.id === id); return t ? `${t.sessionName ?? ''} ${t.name}`.trim() : id; };
  const termsWithResults = [...new Set(results.data.map((r) => r.termId))];
  const tabs: { id: Tab; label: string }[] = [{ id: 'results', label: 'Results' }, { id: 'attendance', label: 'Attendance' }, { id: 'fees', label: 'Fees' }, { id: 'learning', label: 'Learning' }, ...(viewer === 'student' ? [] : [{ id: 'homework' as Tab, label: 'Homework' }]), { id: 'profile', label: 'Profile' }];

  return (
    <div>
      <Card className="mb-5"><CardBody className="flex flex-wrap items-center gap-4"><SecureAvatar name={fullName(student)} collection="students" docId={student.id} photoRef={student.photoRef} legacyUrl={student.photoUrl} size={56} />
        <div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">{fullName(student)}</h2><p className="text-sm text-muted">{student.studentNo} · {student.className ?? 'No class'} · <StatusBadge status={student.status} /></p></div>
        <div className="grid grid-cols-3 gap-4 text-center"><div><p className="text-xs text-muted">Attendance</p><p className="font-heading font-semibold">{attSum.rate}%</p></div><div><p className="text-xs text-muted">Outstanding</p><p className={`font-heading font-semibold ${owing > 0 ? 'text-danger' : ''}`}>{fmtMoney(owing)}</p></div><div><p className="text-xs text-muted">Courses</p><p className="font-heading font-semibold">{enr.data.length}</p></div></div></CardBody></Card>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="pt-5">
        {tab === 'results' && (termsWithResults.length === 0 ? <Card><EmptyState title="No approved results yet" description="Results appear here once the school approves them." /></Card> : (
          <div className="space-y-5">{termsWithResults.map((t) => { const rows = results.data.filter((r) => r.termId === t); const c = cards.data.find((x) => x.termId === t); return (
            <Card key={t}><CardHeader title={termName(t)} action={c && <Button size="sm" variant="outline" onClick={() => setCard(c)}>Report card</Button>} />
              <TableWrap><thead><tr><Th>Subject</Th><Th>CA</Th><Th>Exam</Th><Th>Total</Th><Th>Grade</Th><Th>Remark</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td>{r.subjectName}</Td><Td>{r.ca}</Td><Td>{r.exam}</Td><Td className="font-medium">{r.total}</Td><Td>{r.grade}</Td><Td>{r.remark}</Td></tr>)}</tbody></TableWrap></Card>); })}
            {termsWithResults.length > 1 && <Card><CardHeader title="Performance trend" /><CardBody><div className="h-56"><ResponsiveContainer><LineChart data={termsWithResults.map((t) => { const rs = results.data.filter((r) => r.termId === t); return { term: termName(t), average: Math.round((rs.reduce((s, r) => s + r.total, 0) / rs.length) * 10) / 10 }; })}><CartesianGrid stroke="#e6e3d9" vertical={false} /><XAxis dataKey="term" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip /><Line dataKey="average" stroke={FOREST} strokeWidth={2} dot={{ fill: GOLD, r: 4 }} /></LineChart></ResponsiveContainer></div></CardBody></Card>}</div>))}
        {tab === 'attendance' && <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-4"><StatCard label="Present" value={attSum.present} tone="ok" /><StatCard label="Absent" value={attSum.absent} tone="danger" /><StatCard label="Late" value={attSum.late} tone="gold" /><StatCard label="Excused" value={attSum.excused} /></div>
          <Card>{att.data.length === 0 ? <EmptyState title="No attendance recorded" /> : <TableWrap><thead><tr><Th>Date</Th><Th>Status</Th></tr></thead><tbody>{[...att.data].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60).map((a) => <tr key={a.id}><Td>{fmtDate(a.date)}</Td><Td><StatusBadge status={a.status} /></Td></tr>)}</tbody></TableWrap>}</Card></div>}
        {tab === 'homework' && <ChildHomework studentUid={student.studentUid ?? ''} viewer={viewer} />}
        {tab === 'fees' && <div className="space-y-5">{viewer !== 'staff' && paystackOn && inv.data.some((i) => i.balance > 0 && i.status !== 'cancelled') && <Card><CardBody className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Outstanding fees</p><p className="text-sm text-muted">Pay safely online with Paystack (card, bank transfer or USSD). Use <strong>Pay online</strong> beside an invoice below, or <strong>Part</strong> to pay some now.</p></div></CardBody></Card>}<Card>{inv.data.length === 0 ? <EmptyState title="No invoices" /> : <TableWrap><thead><tr><Th>Invoice</Th><Th>Term</Th><Th>Total</Th><Th>Paid</Th><Th>Balance</Th><Th>Status</Th><Th /></tr></thead><tbody>{inv.data.map((i) => <tr key={i.id}><Td>{i.invoiceNo}</Td><Td>{i.termName}</Td><Td>{fmtMoney(i.total, i.currency)}</Td><Td>{fmtMoney(i.paid, i.currency)}</Td><Td className="font-medium">{fmtMoney(i.balance, i.currency)}</Td><Td><StatusBadge status={i.status} /></Td><Td>{viewer !== 'staff' && paystackOn && i.balance > 0 && i.status !== 'cancelled' && (i.currency || 'NGN') === 'NGN' && <div className="flex gap-1"><Button size="sm" loading={payingId === i.id} onClick={() => void payOnline(i.id)}>Pay online</Button><Button size="sm" variant="ghost" onClick={() => void payOnline(i.id, true)}>Part</Button></div>}</Td></tr>)}</tbody></TableWrap>}</Card>
          {pay.data.length > 0 && <Card><CardHeader title="Payment receipts" /><TableWrap><thead><tr><Th>Receipt</Th><Th>Date</Th><Th>Amount</Th><Th /></tr></thead><tbody>{pay.data.map((p) => <tr key={p.id}><Td>{p.receiptNo}</Td><Td>{fmtDate(p.paidAt)}</Td><Td>{fmtMoney(p.amount, p.currency)}</Td><Td><Button size="icon" variant="ghost" aria-label="Receipt" onClick={() => setReceipt(p)}><ReceiptIcon className="h-4 w-4" /></Button></Td></tr>)}</tbody></TableWrap></Card>}</div>}
        {tab === 'learning' && (enr.data.length === 0 ? <Card><EmptyState title="No courses yet" description={student.studentUid ? 'Enrolled courses and progress appear here.' : 'This learner has no portal login yet.'} /></Card> : <Card><ul className="divide-y divide-line">{enr.data.map((e) => <li key={e.id} className="p-4"><div className="flex justify-between text-sm"><span className="font-medium">{e.courseTitle}</span><span>{e.progressPct}%</span></div><Progress className="mt-2" value={e.progressPct} /></li>)}</ul></Card>)}
        {tab === 'profile' && <Card><CardBody>{canPrintAdmissionLetter(student) && <div className="mb-4"><Button variant="outline" onClick={() => setLetter(true)}>Admission letter</Button></div>}<dl className="grid gap-4 text-sm sm:grid-cols-3">{[['Gender', student.gender], ['Date of birth', fmtDate(student.dob)], ['Programme', student.programme], ['Admission status', student.admissionStatus], ['Address', student.address], ['Guardian phone', student.guardianPhone], ...(can(role, 'students.read') ? [['Allergies / notes', student.allergies], ['Blood group', student.bloodGroup]] : [])].map(([k, v]) => <div key={String(k)}><dt className="text-xs text-muted">{k}</dt><dd className="capitalize">{v || '—'}</dd></div>)}</dl>
          {history.data.length > 0 && can(role, 'students.read') && <div className="mt-6"><h3 className="mb-2 text-sm font-semibold">Student history</h3><ul className="space-y-1 text-sm">{[...history.data].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0)).map((h) => <li key={h.id} className="text-muted"><span className="text-ink">{h.text}</span> — {fmtDate(h.at)} · {h.by}</li>)}</ul></div>}</CardBody></Card>}
      </div>
      <Dialog open={!!card} onClose={() => setCard(null)} title="Report card" size="xl" footer={<Button onClick={() => window.print()}>Print / Save as PDF</Button>}>
        {card && <ReportCardSheet card={card} results={results.data.filter((r) => r.termId === card.termId)} term={terms.data.find((t) => t.id === card.termId)} student={student} className={classes.data.find((c) => c.id === student.classId)?.name ?? student.className} />}
      </Dialog>
      <ReceiptView payment={receipt} onClose={() => setReceipt(null)} />
      <AdmissionLetterDialog student={letter ? student : null} onClose={() => setLetter(false)} />
    </div>
  );
}

export function StudentProfilePage() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { data, loading } = useDocument<Student>(C.students, id);
  if (loading) return <Spinner />;
  if (!data) return <EmptyState title="Student not found" action={<Button onClick={() => nav('/app/ems/students')}>Back to students</Button>} />;
  return <><PageHeader title="Student profile" actions={<Button variant="outline" onClick={() => nav('/app/ems/students')}>← All students</Button>} /><ChildPortal student={data} /></>;
}

export function ChildrenPage() {
  const { uid } = useAuth();
  const { data, loading } = useCollection<Student>(C.students, () => (uid ? [where('parentUids', 'array-contains', uid)] : null), uid ?? '');
  const [sel, setSel] = useState('');
  useEffect(() => { if (!sel && data[0]) setSel(data[0].id); }, [data, sel]);
  const child = data.find((c) => c.id === sel);
  if (loading) return <Spinner />;
  return (
    <>
      <PageHeader title="My children" description="Results, attendance, fees and learning progress." />
      {data.length === 0 ? <Card><EmptyState title="No children linked yet" description="Ask the school office to link your children to your account." /></Card> : (<>
        {data.length > 1 && <div className="mb-4 flex flex-wrap gap-2">{data.map((c) => <Button key={c.id} variant={c.id === sel ? 'primary' : 'outline'} onClick={() => setSel(c.id)}>{c.firstName}</Button>)}</div>}
        {child && <ChildPortal student={child} />}</>)}
    </>
  );
}

export function MyRecordsPage() {
  const { uid } = useAuth();
  const { data, loading } = useCollection<Student>(C.students, () => (uid ? [where('studentUid', '==', uid)] : null), uid ?? '');
  if (loading) return <Spinner />;
  const me = data[0];
  return <><PageHeader title="My records" description="Your results, attendance and fees." />{me ? <ChildPortal student={me} /> : <Card><EmptyState title="No student record linked" description="Ask the school office to link your account." /></Card>}</>;
}

export function NewsPage() {
  const { data, loading } = useCollection<{ title: string; body: string; publishedAt?: unknown; status: string }>(C.announcements, () => [where('status', '==', 'published')], 'pub');
  return (<><PageHeader title="Announcements" />{loading ? <Spinner /> : data.length === 0 ? <Card><EmptyState title="No announcements" /></Card> : <div className="space-y-3">{[...data].sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0)).map((a) => <Card key={a.id}><CardBody><p className="font-heading font-semibold">{a.title}</p><p className="mt-1 text-sm text-muted">{a.body}</p><p className="mt-2 text-xs text-muted">{fmtDate(a.publishedAt)}</p></CardBody></Card>)}</div>}</>);
}

/* --------------------------------------------------------- EMS analytics */
export function EmsOverview() {
  const { role } = useAuth();
  const finance = can(role, 'finance.read');
  const students = useCollection<Student>(C.students, () => [], 'all');
  const staff = useCollection<{ status: string; department?: string }>(C.staff, () => (role === 'teacher' ? null : []), role ?? '');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const enq = useCollection<{ status: string }>(C.admissionEnquiries, () => (can(role, 'admissions.read') ? [] : null), role ?? '');
  const att = useCollection<AttendanceRecord>(C.attendance, () => [], 'all');
  const invoices = useCollection<Invoice>(C.invoices, () => (finance ? [] : null), role ?? '');
  const payments = useCollection<Payment>(C.payments, () => (finance ? [] : null), role ?? '');
  const cards = useCollection<ReportCard>(C.reportCards, () => [], 'all');
  const active = students.data.filter((s) => s.status === 'active');
  const month = new Date(); month.setDate(month.getDate() - 30); const since = month.toISOString().slice(0, 10);
  const newAdm = students.data.filter((s) => (s.admittedAt ?? '') >= since).length;
  const rate = (() => { const r = att.data.filter((a) => a.date >= since); return r.length ? Math.round((r.filter((a) => a.status === 'present' || a.status === 'late').length / r.length) * 100) : 0; })();
  const byDay = useMemo(() => { const m = new Map<string, { t: number; p: number }>(); att.data.filter((a) => a.date >= since).forEach((a) => { const x = m.get(a.date) ?? { t: 0, p: 0 }; x.t++; if (a.status === 'present' || a.status === 'late') x.p++; m.set(a.date, x); }); return [...m.entries()].sort().map(([d, v]) => ({ day: d.slice(5), rate: Math.round((v.p / v.t) * 100) })); }, [att.data, since]);
  const perClass = classes.data.map((c) => { const cs = cards.data.filter((x) => x.classId === c.id); return { name: c.name, students: active.filter((s) => s.classId === c.id).length, average: cs.length ? Math.round((cs.reduce((s, x) => s + x.average, 0) / cs.length) * 10) / 10 : 0 }; });
  const collected = payments.data.reduce((s, p) => s + p.amount, 0);
  const outstanding = invoices.data.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.balance, 0);
  const school = useSchool();
  const chart = (h = 'h-64') => `${h} w-full`;
  return (
    <>
      <PageHeader title="EMS overview" description="Live figures derived from your school’s records." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active students" value={active.length} hint={`${students.data.length} on record`} />
        <StatCard label="New admissions (30d)" value={newAdm} hint={can(role, 'admissions.read') ? `${enq.data.filter((e) => e.status === 'new').length} new enquiries` : undefined} tone="gold" />
        <StatCard label="Active staff" value={staff.data.filter((s) => s.status === 'active').length} hint={`${new Set(staff.data.map((s) => s.department).filter(Boolean)).size} departments`} />
        <StatCard label="Attendance (30d)" value={`${rate}%`} tone={rate >= 85 ? 'ok' : 'danger'} />
        {finance && <><StatCard label="Fees collected" value={fmtMoney(collected, school.currency)} tone="ok" /><StatCard label="Outstanding fees" value={fmtMoney(outstanding, school.currency)} tone="danger" /></>}
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Attendance rate — last 30 days" /><CardBody>{byDay.length === 0 ? <EmptyState title="No attendance data" /> : <div className={chart()}><ResponsiveContainer><LineChart data={byDay}><CartesianGrid stroke="#e6e3d9" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" /><Tooltip /><Line dataKey="rate" stroke={FOREST} strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div>}</CardBody></Card>
        <Card><CardHeader title="Students per class" /><CardBody>{perClass.length === 0 ? <EmptyState title="No classes" /> : <div className={chart()}><ResponsiveContainer><BarChart data={perClass}><CartesianGrid stroke="#e6e3d9" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="students" fill={FOREST} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}</CardBody></Card>
        <Card className="lg:col-span-2"><CardHeader title="Academic performance — class averages (report cards)" /><CardBody>{perClass.every((c) => !c.average) ? <EmptyState title="No report cards generated yet" /> : <div className={chart()}><ResponsiveContainer><BarChart data={perClass}><CartesianGrid stroke="#e6e3d9" vertical={false} /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis domain={[0, 100]} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="average" fill={GOLD} radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>}</CardBody></Card>
      </div>
    </>
  );
}

/* ----------------------------------------------------------- school settings */
export function SchoolSettingsPage() {
  const toast = useToast();
  const school = useSchool();
  const { __loaded, ...initial } = school;
  if (!__loaded) return <Spinner />;
  return (
    <>
      <PageHeader title="School settings" description="Currency, report-card settings and assessment maximums." />
      <Card className="max-w-2xl"><CardBody><EntityForm initial={initial as unknown as Record<string, unknown>} submitLabel="Save settings" fields={[
        { name: 'schoolName', label: 'School name', type: 'text', required: true }, { name: 'currency', label: 'Currency code (ISO)', type: 'text', required: true, hint: 'e.g. NGN, USD, GBP' },
        { name: 'address', label: 'Address (receipts & reports)', type: 'text', span: 2 }, { name: 'caMax', label: 'Max continuous-assessment score', type: 'number', required: true, min: 1, max: 100 }, { name: 'examMax', label: 'Max exam score', type: 'number', required: true, min: 1, max: 100 },
        { name: 'signatoryName', label: 'Signatory name (printed under the signature)', type: 'text' }, { name: 'signatoryTitle', label: 'Signatory title', type: 'text', placeholder: 'Principal' }, { name: 'signatureUrl', label: 'Signature image (transparent PNG works best)', type: 'image', span: 2 }, { name: 'stampUrl', label: 'School stamp image (transparent PNG works best)', type: 'image', span: 2 }, { name: 'admissionNote', label: 'Admission letter note (what to bring, conditions, resumption date)', type: 'textarea', span: 2 }, { name: 'paymentNote', label: 'Payment instructions (shown on invoices)', type: 'textarea' }, { name: 'reportFooter', label: 'Report card footer', type: 'textarea' }]}
        onSubmit={async (p) => {
          if (Number(p.caMax) + Number(p.examMax) !== 100) return toast.error('CA max + exam max must equal 100.');
          try { await setDoc(doc(db(), C.settings, 'school'), { ...SCHOOL_DEFAULTS, ...p, currency: String(p.currency).toUpperCase(), updatedAt: serverTimestamp() }, { merge: true }); void audit('settings.update', 'settings/school'); toast.success('Saved'); } catch (e) { toast.error(errorMessage(e)); }
        }} /></CardBody></Card>
    </>
  );
}
