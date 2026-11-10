import { useState } from 'react';
import { limit } from 'firebase/firestore';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/data';
import { useCollection } from '@/hooks/useFirestore';
import { useToast } from '@/components/ui/overlay';
import { C } from '@/config/collections';
import { toCsv } from '@/lib/csv';
import { downloadText } from '@/lib/utils';
import { audit } from '@/services/audit';
import type { ClassRoom, Student } from '@/types/models';

type Pay = { receiptNo: string; invoiceNo?: string; studentName: string; amount: number; method: string; paidAt: string; recordedBy: string; reference?: string; currency?: string };
type Inv = { invoiceNo: string; studentName: string; className?: string; termName?: string; total: number; paid: number; balance: number; status: string; dueDate?: string; currency?: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** One-click CSV exports for the office. Each export is recorded in the audit log. */
export function ReportsPage() {
  const toast = useToast();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(iso(new Date()));
  const pays = useCollection<Pay>(C.payments, () => [limit(5000)], 'rep');
  const invs = useCollection<Inv>(C.invoices, () => [limit(5000)], 'rep');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'rep');
  const students = useCollection<Student>(C.students, () => [limit(5000)], 'rep');
  const loading = pays.loading || invs.loading || classes.loading || students.loading;
  const out = (name: string, rows: (string | number | null | undefined)[][], note: string) => { downloadText(`${name}.csv`, toCsv(rows)); void audit('report.export', name, note); toast.success(`${rows.length - 1} rows exported`); };

  const payments = () => {
    const rows = pays.data.filter((p) => p.paidAt >= from && p.paidAt <= to).sort((a, b) => a.paidAt.localeCompare(b.paidAt));
    out(`payments_${from}_to_${to}`, [['Date', 'Receipt', 'Invoice', 'Learner', 'Amount', 'Currency', 'Method', 'Reference', 'Recorded by'], ...rows.map((p) => [p.paidAt, p.receiptNo, p.invoiceNo ?? '', p.studentName, p.amount, p.currency ?? 'NGN', p.method, p.reference ?? '', p.recordedBy])], `${rows.length} payments, total ${rows.reduce((s, p) => s + p.amount, 0)}`);
  };
  const debtors = () => {
    const rows = invs.data.filter((i) => i.balance > 0 && i.status !== 'cancelled').sort((a, b) => b.balance - a.balance);
    out('outstanding_fees', [['Invoice', 'Learner', 'Class', 'Term', 'Total', 'Paid', 'Balance', 'Due date', 'Status'], ...rows.map((i) => [i.invoiceNo, i.studentName, i.className ?? '', i.termName ?? '', i.total, i.paid, i.balance, i.dueDate ?? '', i.status])], `${rows.length} invoices`);
  };
  const classList = () => {
    const rows = classes.data.map((c) => [c.name, students.data.filter((s) => s.classId === c.id && s.status === 'active').length, (c.subjectNames ?? []).join('; ')]);
    out('classes_and_subjects', [['Class', 'Active learners', 'Subjects'], ...rows], `${rows.length} classes`);
  };
  const roll = () => {
    const rows = students.data.filter((s) => s.status === 'active').sort((a, b) => (a.className ?? '').localeCompare(b.className ?? '') || a.lastName.localeCompare(b.lastName)).map((s) => [s.studentNo, `${s.firstName} ${s.lastName}`, s.className ?? '', s.gender ?? '', s.admittedAt ?? '', s.guardianPhone ?? '']);
    out('student_roll', [['Student no.', 'Name', 'Class', 'Gender', 'Admitted', 'Guardian phone'], ...rows], `${rows.length} learners`);
  };

  if (loading) return <Spinner />;
  const total = pays.data.filter((p) => p.paidAt >= from && p.paidAt <= to).reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <PageHeader title="Reports" description="Download office reports as spreadsheets (CSV)." />
      <Card className="mb-5"><CardHeader title="Fees" /><CardBody className="space-y-3">
        <div className="flex flex-wrap gap-3"><Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field><Field label="To">{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field></div>
        <p className="text-sm text-muted">Collected in this period: <strong>NGN {total.toLocaleString('en-NG')}</strong></p>
        <div className="flex flex-wrap gap-2"><Button onClick={payments}><Download className="mr-1 h-4 w-4" />Payments</Button><Button variant="outline" onClick={debtors}><Download className="mr-1 h-4 w-4" />Outstanding fees</Button></div>
      </CardBody></Card>
      <Card><CardHeader title="School" /><CardBody className="flex flex-wrap gap-2"><Button variant="outline" onClick={roll}><Download className="mr-1 h-4 w-4" />Student roll</Button><Button variant="outline" onClick={classList}><Download className="mr-1 h-4 w-4" />Classes and subjects</Button></CardBody></Card>
    </>
  );
}
