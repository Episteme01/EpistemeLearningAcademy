import { useEffect, useMemo, useState } from 'react';
import { where, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { EmptyState, Spinner, StatusBadge, TableWrap, Td, Th } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { BRAND } from '@/config/brand';
import { db } from '@/config/firebase';
import { can } from '@/config/permissions';
import { DEFAULT_GRADING_SCALE, computeSubjectResult, gradeFor, ordinal, validateScale, validateScores, type GradeBand, type GradingScale } from '@/lib/assessment';
import { approveResults, fullName, generateReportCards, saveResultRows } from '@/services/ems';
import { patchDoc } from '@/services/db';
import { notifyUsers } from '@/services/notifications';
import { audit } from '@/services/audit';
import { errorMessage } from '@/lib/utils';
import type { ClassRoom, ReportCard, ResultRecord, Student, Subject, TeacherAssignment, Term, WithId } from '@/types/models';
import { useSchool } from './operations';

/** Active scale = the one flagged default in Firestore, else the built-in standard scale. */
export function useScale(): GradingScale {
  const { data } = useCollection<GradingScale>(C.gradingScales, () => [], 'all');
  return data.find((s) => s.isDefault) ?? DEFAULT_GRADING_SCALE;
}

function TermClassPicker({ termId, setTermId, classId, setClassId, children, onlyAssigned }: { termId: string; setTermId: (v: string) => void; classId: string; setClassId: (v: string) => void; children?: React.ReactNode; onlyAssigned?: TeacherAssignment[] }) {
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  useEffect(() => { if (!termId) { const cur = terms.data.find((t) => t.current); if (cur) setTermId(cur.id); } }, [terms.data, termId, setTermId]);
  const classList = onlyAssigned ? classes.data.filter((c) => onlyAssigned.some((a) => a.classId === c.id)) : classes.data;
  return (
    <Card className="mb-4"><CardBody className="flex flex-wrap items-end gap-3">
      <Field label="Term" className="min-w-52">{(a) => <Select {...a} value={termId} onChange={(e) => setTermId(e.target.value)}><option value="">Select term…</option>{terms.data.map((t) => <option key={t.id} value={t.id}>{t.sessionName} — {t.name}{t.current ? ' (current)' : ''}</option>)}</Select>}</Field>
      <Field label="Class" className="min-w-44">{(a) => <Select {...a} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select class…</option>{classList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
      {children}
    </CardBody></Card>
  );
}

/* ---------------------------------------------------------------- score entry */
export function ResultsEntryPage() {
  const { role, uid, profile } = useAuth();
  const toast = useToast();
  const school = useSchool();
  const scale = useScale();
  const [termId, setTermId] = useState(''); const [classId, setClassId] = useState(''); const [subjectId, setSubjectId] = useState('');
  const subjects = useCollection<Subject>(C.subjects, () => [], 'all');
  const assignments = useCollection<TeacherAssignment>(C.teacherAssignments, () => (role === 'teacher' && uid ? [where('staffUid', '==', uid)] : []), `${role}${uid}`);
  const students = useCollection<Student>(C.students, () => (classId ? [where('classId', '==', classId)] : null), classId);
  const existing = useCollection<ResultRecord>(C.results, () => (termId && classId ? [where('termId', '==', termId), where('classId', '==', classId)] : null), `${termId}${classId}`);
  const [vals, setVals] = useState<Record<string, { ca: string; exam: string; comment: string }>>({});
  const [busy, setBusy] = useState(false);
  const mine = role === 'teacher' ? assignments.data : undefined;
  const subjOpts = subjects.data.filter((s) => (mine ? mine.some((a) => a.classId === classId && a.subjectId === s.id) : true));
  const active = useMemo(() => students.data.filter((s) => s.status === 'active').sort((a, b) => a.lastName.localeCompare(b.lastName)), [students.data]);

  useEffect(() => {
    const v: typeof vals = {};
    existing.data.filter((r) => r.subjectId === subjectId).forEach((r) => { v[r.studentId] = { ca: String(r.ca), exam: String(r.exam), comment: r.teacherComment ?? '' }; });
    setVals(v);
  }, [existing.data, subjectId]);

  const rowState = (id: string) => existing.data.find((r) => r.studentId === id && r.subjectId === subjectId)?.status;
  const save = async (status: 'draft' | 'submitted') => {
    const subj = subjects.data.find((s) => s.id === subjectId);
    if (!termId || !classId || !subj) return toast.error('Choose term, class and subject.');
    const rows: Parameters<typeof saveResultRows>[0] = [];
    for (const s of active) {
      const v = vals[s.id]; if (!v || (v.ca === '' && v.exam === '')) continue;
      if (rowState(s.id) === 'approved') continue;
      const ca = Number(v.ca || 0), exam = Number(v.exam || 0);
      const err = validateScores(ca, exam, school); if (err) return toast.error(`${fullName(s)}: ${err}`);
      rows.push({ student: s, ca, exam, comment: v.comment });
    }
    if (!rows.length) return toast.error('Enter at least one score.');
    setBusy(true);
    try { await saveResultRows(rows, { termId, classId, subjectId, subjectName: subj.name, scale, status, by: profile?.displayName ?? '' }); toast.success(status === 'submitted' ? 'Submitted for approval' : 'Draft saved'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Score entry" description={`Continuous assessment (max ${school.caMax}) + exam (max ${school.examMax}). Totals and grades are calculated automatically.`} />
      <TermClassPicker termId={termId} setTermId={setTermId} classId={classId} setClassId={setClassId} onlyAssigned={mine}>
        <Field label="Subject" className="min-w-44">{(a) => <Select {...a} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}><option value="">Select subject…</option>{subjOpts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
      </TermClassPicker>
      {role === 'teacher' && !assignments.loading && assignments.data.length === 0 && <Card className="mb-4"><EmptyState title="No teaching assignments" description="Ask an administrator to assign you to a class and subject (EMS → Teacher assignments)." /></Card>}
      {!termId || !classId || !subjectId ? <Card><EmptyState title="Select term, class and subject" /></Card> : students.loading ? <Spinner /> : (
        <Card><CardHeader title={`${active.length} students`} action={<div className="flex gap-2"><Button size="sm" variant="outline" loading={busy} onClick={() => void save('draft')}>Save draft</Button><Button size="sm" loading={busy} onClick={() => void save('submitted')}>Submit for approval</Button></div>} />
          <TableWrap><thead><tr><Th>Student</Th><Th>CA /{school.caMax}</Th><Th>Exam /{school.examMax}</Th><Th>Total</Th><Th>Grade</Th><Th>Comment</Th><Th>Status</Th></tr></thead>
            <tbody>{active.map((s) => {
              const v = vals[s.id] ?? { ca: '', exam: '', comment: '' }; const st = rowState(s.id); const locked = st === 'approved';
              const calc = v.ca !== '' || v.exam !== '' ? computeSubjectResult(Number(v.ca || 0), Number(v.exam || 0), scale) : null;
              return (<tr key={s.id}><Td className="whitespace-nowrap font-medium">{fullName(s)}</Td>
                <Td><Input aria-label={`CA for ${fullName(s)}`} className="w-20" type="number" min={0} max={school.caMax} disabled={locked} value={v.ca} onChange={(e) => setVals({ ...vals, [s.id]: { ...v, ca: e.target.value } })} /></Td>
                <Td><Input aria-label={`Exam for ${fullName(s)}`} className="w-20" type="number" min={0} max={school.examMax} disabled={locked} value={v.exam} onChange={(e) => setVals({ ...vals, [s.id]: { ...v, exam: e.target.value } })} /></Td>
                <Td className="font-medium">{calc?.total ?? '—'}</Td><Td>{calc ? `${calc.grade}` : '—'}</Td>
                <Td><Input aria-label={`Comment for ${fullName(s)}`} className="min-w-40" disabled={locked} value={v.comment} onChange={(e) => setVals({ ...vals, [s.id]: { ...v, comment: e.target.value } })} /></Td>
                <Td>{st ? <StatusBadge status={st} /> : '—'}</Td></tr>);
            })}</tbody></TableWrap></Card>)}
    </>
  );
}

/* ------------------------------------------------------------------ approvals */
export function ApprovalsPage() {
  const toast = useToast();
  const [termId, setTermId] = useState(''); const [classId, setClassId] = useState('');
  const res = useCollection<ResultRecord>(C.results, () => (termId && classId ? [where('termId', '==', termId), where('classId', '==', classId)] : null), `${termId}${classId}`);
  const [busy, setBusy] = useState(false);
  const bySubject = useMemo(() => { const m = new Map<string, WithId<ResultRecord>[]>(); res.data.forEach((r) => m.set(r.subjectName, [...(m.get(r.subjectName) ?? []), r])); return [...m.entries()]; }, [res.data]);
  const approve = async (rows: WithId<ResultRecord>[]) => {
    setBusy(true);
    try { await approveResults(rows.filter((r) => r.status === 'submitted').map((r) => r.id), termId); toast.success('Approved — visible to parents and students'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const reject = async (rows: WithId<ResultRecord>[]) => { try { await Promise.all(rows.filter((r) => r.status === 'submitted').map((r) => patchDoc(C.results, r.id, { status: 'draft' }))); toast.success('Returned to teacher as draft'); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <>
      <PageHeader title="Result approvals" description="Review submitted results. Only approved results are visible to parents and students." />
      <TermClassPicker termId={termId} setTermId={setTermId} classId={classId} setClassId={setClassId} />
      {!termId || !classId ? <Card><EmptyState title="Select term and class" /></Card> : res.loading ? <Spinner /> : bySubject.length === 0 ? <Card><EmptyState title="No results entered yet" /></Card> : (
        <div className="space-y-4">{bySubject.map(([subject, rows]) => {
          const submitted = rows.filter((r) => r.status === 'submitted').length; const approved = rows.filter((r) => r.status === 'approved').length;
          return (<Card key={subject}><CardHeader title={subject} description={`${rows.length} scores · ${submitted} awaiting approval · ${approved} approved`} action={submitted > 0 ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void reject(rows)}>Return to teacher</Button><Button size="sm" loading={busy} onClick={() => void approve(rows)}>Approve {submitted}</Button></div> : undefined} />
            <TableWrap><thead><tr><Th>Student</Th><Th>CA</Th><Th>Exam</Th><Th>Total</Th><Th>Grade</Th><Th>Status</Th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><Td>{r.studentName}</Td><Td>{r.ca}</Td><Td>{r.exam}</Td><Td className="font-medium">{r.total}</Td><Td>{r.grade}</Td><Td><StatusBadge status={r.status} /></Td></tr>)}</tbody></TableWrap></Card>);
        })}</div>)}
    </>
  );
}

/* ---------------------------------------------------------------- report cards */
export function ReportCardSheet({ card, results, term, student, className }: { card: WithId<ReportCard>; results: WithId<ResultRecord>[]; term?: Term; student?: Student; className?: string }) {
  const school = useSchool();
  return (
    <div className="print-area rounded-lg border border-line bg-white p-6 text-sm">
      <div className="flex items-center gap-4 border-b-2 border-forest-700 pb-4">
        <img src={BRAND.logo} alt="" className="h-16 w-16 object-contain" />
        <div className="flex-1 text-center"><p className="font-heading text-xl font-semibold text-forest-700">{school.schoolName}</p><p className="text-xs text-muted">{BRAND.motto} · {school.address}</p><p className="mt-1 font-heading text-sm font-semibold uppercase tracking-widest text-gold-600">Terminal report card</p></div>
        <div className="h-16 w-16" />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Name</dt><dd className="font-medium">{card.studentName}</dd></div><div><dt className="text-xs text-muted">Student no.</dt><dd>{student?.studentNo ?? '—'}</dd></div>
        <div><dt className="text-xs text-muted">Class</dt><dd>{className ?? '—'}</dd></div><div><dt className="text-xs text-muted">Term</dt><dd>{term ? `${term.sessionName ?? ''} ${term.name}` : '—'}</dd></div>
      </dl>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[480px] border-collapse text-left"><thead><tr className="bg-forest-700 text-white">{['Subject', 'CA', 'Exam', 'Total', 'Grade', 'Remark'].map((h) => <th key={h} className="px-3 py-2 text-xs font-medium">{h}</th>)}</tr></thead>
        <tbody>{[...results].sort((a, b) => a.subjectName.localeCompare(b.subjectName)).map((r) => <tr key={r.id} className="border-b border-line"><td className="px-3 py-1.5">{r.subjectName}</td><td className="px-3">{r.ca}</td><td className="px-3">{r.exam}</td><td className="px-3 font-medium">{r.total}</td><td className="px-3">{r.grade}</td><td className="px-3">{r.remark}</td></tr>)}</tbody></table></div>
      <div className="mt-4 grid grid-cols-3 gap-3 rounded bg-cream p-3 text-center"><div><p className="text-xs text-muted">Total</p><p className="font-heading text-lg font-semibold">{card.total}</p></div><div><p className="text-xs text-muted">Average</p><p className="font-heading text-lg font-semibold">{card.average}%</p></div><div><p className="text-xs text-muted">Position</p><p className="font-heading text-lg font-semibold">{card.position ? `${ordinal(card.position)} of ${card.classSize}` : '—'}</p></div></div>
      <div className="mt-4 space-y-3"><div><p className="text-xs font-medium text-muted">Class teacher’s comment</p><p>{card.teacherComment || '—'}</p></div><div><p className="text-xs font-medium text-muted">Principal’s comment</p><p>{card.principalComment || '—'}</p></div></div>
      <div className="mt-6 flex items-end justify-between"><div className="text-center"><img src={BRAND.signature} alt="" className="mx-auto h-12" /><p className="border-t border-ink px-6 pt-1 text-xs">Principal</p></div><img src={BRAND.stamp} alt="" className="h-20 opacity-80" /></div>
      {school.reportFooter && <p className="mt-4 text-center text-xs text-muted">{school.reportFooter}</p>}
    </div>
  );
}

export function ReportCardsPage() {
  const { role } = useAuth();
  const toast = useToast();
  const [termId, setTermId] = useState(''); const [classId, setClassId] = useState('');
  const terms = useCollection<Term>(C.terms, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const students = useCollection<Student>(C.students, () => (classId ? [where('classId', '==', classId)] : null), classId);
  const cards = useCollection<ReportCard>(C.reportCards, () => (termId && classId ? [where('termId', '==', termId), where('classId', '==', classId)] : null), `${termId}${classId}`);
  const results = useCollection<ResultRecord>(C.results, () => (termId && classId ? [where('termId', '==', termId), where('classId', '==', classId)] : null), `${termId}${classId}`);
  const [view, setView] = useState<WithId<ReportCard> | null>(null);
  const [edit, setEdit] = useState<WithId<ReportCard> | null>(null);
  const [tc, setTc] = useState(''); const [pc, setPc] = useState('');
  const [busy, setBusy] = useState(false);
  const leader = can(role, 'results.approve');
  const gen = async () => { setBusy(true); try { const n = await generateReportCards(classId, termId, students.data.filter((s) => s.status === 'active')); toast.success(`${n} report card(s) generated`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const approveAll = async () => {
    setBusy(true);
    try {
      await Promise.all(cards.data.filter((c) => c.status !== 'approved').map((c) => patchDoc(C.reportCards, c.id, { status: 'approved' })));
      void notifyUsers(cards.data.flatMap((c) => c.parentUids), { title: 'Report cards published', body: 'Open “My children” → Results.', link: '/app/ems/children' });
      void audit('reportcards.approve', `terms/${termId}`, classId); toast.success('Report cards approved and published');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const saveComments = async () => { if (!edit) return; try { await patchDoc(C.reportCards, edit.id, leader ? { teacherComment: tc, principalComment: pc } : { teacherComment: tc }); toast.success('Comments saved'); setEdit(null); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <>
      <PageHeader title="Report cards" description="Generate termly report cards from results, add comments, approve and print / save as PDF." />
      <TermClassPicker termId={termId} setTermId={setTermId} classId={classId} setClassId={setClassId}>
        {leader && termId && classId && <><Button loading={busy} variant="outline" onClick={() => void gen()}>Generate / refresh</Button><Button loading={busy} onClick={() => void approveAll()}>Approve all</Button></>}
      </TermClassPicker>
      {!termId || !classId ? <Card><EmptyState title="Select term and class" /></Card> : cards.loading ? <Spinner /> : cards.data.length === 0 ? <Card><EmptyState title="No report cards yet" description="Enter results first, then press “Generate / refresh”." /></Card> : (
        <Card><TableWrap><thead><tr><Th>Student</Th><Th>Total</Th><Th>Average</Th><Th>Position</Th><Th>Status</Th><Th /></tr></thead><tbody>{[...cards.data].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map((c) => (
          <tr key={c.id}><Td className="font-medium">{c.studentName}</Td><Td>{c.total}</Td><Td>{c.average}%</Td><Td>{c.position ? ordinal(c.position) : '—'}</Td><Td><StatusBadge status={c.status} /></Td>
            <Td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setEdit(c); setTc(c.teacherComment ?? ''); setPc(c.principalComment ?? ''); }}>Comments</Button><Button size="sm" variant="outline" onClick={() => setView(c)}>View</Button></Td></tr>))}</tbody></TableWrap></Card>)}
      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Comments" description={edit?.studentName} footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => void saveComments()}>Save</Button></>}>
        <div className="space-y-4"><Field label="Class teacher’s comment">{(a) => <Textarea {...a} value={tc} onChange={(e) => setTc(e.target.value)} />}</Field>{leader && <Field label="Principal’s comment">{(a) => <Textarea {...a} value={pc} onChange={(e) => setPc(e.target.value)} />}</Field>}</div>
      </Dialog>
      <Dialog open={!!view} onClose={() => setView(null)} title="Report card" size="xl" footer={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button>}>
        {view && <ReportCardSheet card={view} results={results.data.filter((r) => r.studentId === view.studentId)} term={terms.data.find((t) => t.id === termId)} student={students.data.find((s) => s.id === view.studentId)} className={classes.data.find((c) => c.id === classId)?.name} />}
      </Dialog>
    </>
  );
}

/* ---------------------------------------------------------------- grading scales */
export function GradingPage() {
  const toast = useToast();
  const { data, loading } = useCollection<GradingScale>(C.gradingScales, () => [], 'all');
  const [text, setText] = useState('');
  const [name, setName] = useState('Standard (A–F)');
  const current = data.find((s) => s.isDefault);
  useEffect(() => {
    const src = current ?? DEFAULT_GRADING_SCALE;
    setName(src.name);
    setText(src.bands.map((b) => `${b.min}-${b.max} | ${b.grade} | ${b.remark}`).join('\n'));
  }, [current?.id, loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const parse = (): GradeBand[] => text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const [range, grade, remark] = l.split('|').map((s) => s.trim());
    const [min, max] = (range ?? '').split('-').map(Number);
    if (min === undefined || max === undefined || Number.isNaN(min) || Number.isNaN(max) || !grade) throw new Error(`Invalid line “${l}”. Use  min-max | grade | remark`);
    return { min, max, grade, remark: remark ?? '' };
  });
  const bands = useMemo(() => { try { return parse(); } catch { return null; } }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = bands ? validateScale(bands) : ['Check the format of every line.'];
  const save = async () => {
    try {
      const b = parse(); const errs = validateScale(b); if (errs.length) return toast.error(errs[0] as string);
      await setDoc(doc(db(), C.gradingScales, 'default'), { name, isDefault: true, bands: b, updatedAt: serverTimestamp() }, { merge: true });
      void audit('gradingscale.update', 'gradingScales/default'); toast.success('Grading scale saved');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Grading scale" description="Configurable grade bands used for all subject results. One band per line:  min-max | grade | remark." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardBody className="space-y-4"><Field label="Scale name">{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Bands">{(a) => <Textarea {...a} rows={9} className="font-mono text-[13px]" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
          {errors.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
          <Button onClick={() => void save()} disabled={errors.length > 0}>Save scale</Button></CardBody></Card>
        <Card><CardHeader title="Preview" /><CardBody><ul className="space-y-1.5 text-sm">{[0, 25, 40, 45, 50, 60, 65, 75, 90, 100].map((n) => <li key={n} className="flex justify-between border-b border-line/60 pb-1"><span>{n}%</span><span className="font-medium">{bands && errors.length === 0 ? gradeFor(n, { name, bands }).grade : '—'}</span></li>)}</ul></CardBody></Card>
      </div>
    </>
  );
}
