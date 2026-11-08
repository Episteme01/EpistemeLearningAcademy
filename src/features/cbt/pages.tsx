import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { Download, Eye, EyeOff, Upload } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { DataTable } from '@/components/common/DataTable';
import { EntityForm } from '@/components/common/EntityForm';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Badge, EmptyState, Spinner, StatusBadge, TableWrap, Td, Th } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { batchSet, createDoc, patchDoc, removeDoc } from '@/services/db';
import { applyManualMark, gradeExamAttempts, publishExam, setReleased } from '@/services/cbt';
import { audit } from '@/services/audit';
import { CSV_TEMPLATE, parseQuestionCsv, type CsvImportResult } from '@/lib/cbt/csvQuestions';
import { downloadText, errorMessage, fmtDate, toDate } from '@/lib/utils';
import { toCsv } from '@/lib/csv';
import type { Attempt, BankQuestion, CbtResult, ClassRoom, Exam, PaperQuestion, Student, Subject, WithId } from '@/types/models';

type Row = Record<string, unknown> & { id: string };
const DIFF = [{ value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }];

/* ------------------------------------------------------------ question bank */
export function QuestionBankPage() {
  const { uid } = useAuth();
  const toast = useToast();
  const subjects = useCollection<Subject>(C.subjects, () => [], 'all');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvSubject, setCsvSubject] = useState('');
  const [csvClass, setCsvClass] = useState('');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = async (f?: File) => { if (!f) return; if (f.size > 2_000_000) return toast.error('CSV is too large (max 2 MB).'); setPreview(parseQuestionCsv(await f.text())); };
  const importNow = async () => {
    const subj = subjects.data.find((s) => s.id === csvSubject);
    if (!subj || !preview?.valid.length) return toast.error('Choose a subject and a CSV with valid rows.');
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const q of preview.valid) {
        const id = await createDoc(C.questions, { type: q.type, prompt: q.prompt, options: q.options, marks: q.marks, difficulty: q.difficulty, topic: q.topic, subjectId: subj.id, subjectName: subj.name, classId: csvClass, createdBy: uid ?? '' });
        ids.push(id);
        await batchSet([{ col: C.questionKeys, id, data: q.key, merge: false }]);
      }
      void audit('questions.import', 'questions', `${ids.length} questions`); toast.success(`${ids.length} questions imported`); setCsvOpen(false); setPreview(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  // the form collects the answer in friendly fields; beforeSave splits question vs key
  const config: CrudConfig<BankQuestion & Row> = {
    collection: C.questions, singular: 'Question', plural: 'Question bank', description: 'Questions organised by subject, class, topic and difficulty. Answer keys are stored separately and never sent to students.', dialogSize: 'xl', auditActions: true,
    fields: [
      { name: 'prompt', label: 'Question', type: 'textarea', required: true }, { name: 'imageUrl', label: 'Image (optional)', type: 'image' },
      { name: 'type', label: 'Type', type: 'select', required: true, defaultValue: 'mcq', options: [{ value: 'mcq', label: 'Multiple choice' }, { value: 'tf', label: 'True / false' }, { value: 'short', label: 'Short answer' }] },
      { name: 'marks', label: 'Marks', type: 'number', required: true, min: 0.5, max: 100, defaultValue: 1 },
      { name: 'optionsText', label: 'Options (MCQ — one per line)', type: 'list' }, { name: 'correctAnswer', label: 'Correct answer', type: 'text', required: true, hint: 'MCQ: option number (1,2,3…). True/false: true or false. Short: accepted answers separated by |' },
      { name: 'manual', label: 'Needs manual marking (short answers)', type: 'checkbox' }, { name: 'explanation', label: 'Explanation (staff only)', type: 'textarea' },
      { name: 'subjectId', label: 'Subject', type: 'ref', required: true, ref: { collection: C.subjects, label: (r) => String(r.name), labelField: 'subjectName' } },
      { name: 'classId', label: 'Class', type: 'ref', ref: { collection: C.classes, label: (r) => String(r.name) } }, { name: 'topic', label: 'Topic', type: 'text' }, { name: 'difficulty', label: 'Difficulty', type: 'select', required: true, defaultValue: 'medium', options: DIFF },
    ],
    beforeSave: (p) => {
      const type = String(p.type); const options = type === 'mcq' ? ((p.optionsText as string[]) ?? []).map((t, i) => ({ id: `o${i + 1}`, text: t })) : [];
      const ca = String(p.correctAnswer ?? '').trim();
      if (type === 'mcq') { if (options.length < 2) throw new Error('Multiple choice needs at least 2 options.'); if (!options[Number(ca) - 1]) throw new Error('Correct answer must be a valid option number.'); }
      if (type === 'tf' && !['true', 'false'].includes(ca.toLowerCase())) throw new Error('Correct answer must be true or false.');
      const { optionsText, correctAnswer, manual, explanation, ...rest } = p; void optionsText; void correctAnswer; void manual; void explanation;
      return { ...rest, options, __key: type === 'mcq' ? { correct: `o${ca}` } : type === 'tf' ? { correct: ca.toLowerCase() } : { accepted: ca.split('|').map((s) => s.trim()).filter(Boolean), manual: !!manual }, __expl: p.explanation ?? '' };
    },
    afterSave: async (id, p) => {
      const key = { ...(p.__key as object), ...(p.__expl ? { explanation: String(p.__expl) } : {}) };
      await batchSet([{ col: C.questionKeys, id, data: key, merge: false }]);
      await patchDoc(C.questions, id, { __key: null, __expl: null }).catch(() => undefined);
    },
    columns: [
      { key: 'p', header: 'Question', primary: true, cell: (r) => <span className="line-clamp-2 max-w-md">{r.prompt}</span> }, { key: 't', header: 'Type', cell: (r) => r.type }, { key: 's', header: 'Subject', cell: (r) => r.subjectName ?? '—' },
      { key: 'd', header: 'Difficulty', cell: (r) => <Badge tone={r.difficulty === 'hard' ? 'danger' : r.difficulty === 'easy' ? 'ok' : 'warn'}>{r.difficulty}</Badge> }, { key: 'm', header: 'Marks', cell: (r) => r.marks },
    ],
    searchKeys: ['prompt', 'topic', 'subjectName'], filters: [{ name: 'subjectId', label: 'Subject', options: subjects.data.map((s) => ({ value: s.id, label: s.name })) }, { name: 'difficulty', label: 'Difficulty', options: DIFF }, { name: 'type', label: 'Type', options: [{ value: 'mcq', label: 'MCQ' }, { value: 'tf', label: 'True/false' }, { value: 'short', label: 'Short' }] }],
    sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    headerActions: <Button variant="outline" onClick={() => setCsvOpen(true)}><Upload className="h-4 w-4" /> Import CSV</Button>,
    beforeDelete: async (r) => { await removeDoc(C.questionKeys, r.id).catch(() => undefined); },
  };
  return (
    <>
      <CrudPage config={config} />
      <Dialog open={csvOpen} onClose={() => setCsvOpen(false)} title="Import questions from CSV" size="lg" footer={<><Button variant="outline" onClick={() => setCsvOpen(false)}>Cancel</Button><Button loading={busy} disabled={!preview?.valid.length} onClick={() => void importNow()}>Import {preview?.valid.length ?? 0} question(s)</Button></>}>
        <div className="space-y-4"><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => downloadText('question_template.csv', CSV_TEMPLATE)}><Download className="h-4 w-4" /> Download template</Button><Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>Choose CSV file</Button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void readFile(e.target.files?.[0]); e.target.value = ''; }} /></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Subject for all rows" required>{(a) => <Select {...a} value={csvSubject} onChange={(e) => setCsvSubject(e.target.value)}><option value="">Select…</option>{subjects.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field><Field label="Class (optional)">{(a) => <Select {...a} value={csvClass} onChange={(e) => setCsvClass(e.target.value)}><option value="">Any</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field></div>
          {preview && <div><p className="text-sm"><strong className="text-ok">{preview.valid.length} valid</strong> · <strong className={preview.errors.length ? 'text-danger' : ''}>{preview.errors.length} with errors</strong> (error rows are skipped)</p>
            {preview.errors.length > 0 && <ul className="mt-2 max-h-40 list-disc overflow-y-auto pl-5 text-sm text-danger">{preview.errors.map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}</ul>}</div>}</div>
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------------- exams */
export function ExamsPage() {
  const { role, uid, profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data, loading, error } = useCollection<Exam>(C.exams, () => [], 'all');
  const rows = data.filter((e) => role !== 'teacher' || e.createdBy === uid).sort((a, b) => (toDate(b.startsAt)?.getTime() ?? 0) - (toDate(a.startsAt)?.getTime() ?? 0));
  const create = async () => {
    try {
      const id = await createDoc(C.exams, { title: 'Untitled examination', subjectId: '', instructions: 'Read each question carefully. Your answers are saved automatically.', classIds: [], studentUids: [], startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000), durationMinutes: 60, passMark: 50, negativeMarking: { enabled: false, penalty: 0 }, shuffleQuestions: true, shuffleOptions: true, questionIds: [], questionCount: 0, maxAttempts: 1, releasePolicy: 'manual', status: 'draft', totalMarks: 0, createdBy: uid ?? '', createdByName: profile?.displayName ?? '' });
      nav(`/app/cbt/exams/${id}`);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Examinations" description="Create, schedule and publish computer-based examinations." actions={<Button onClick={() => void create()}>New examination</Button>} />
      <DataTable rows={rows} loading={loading} error={error} emptyTitle="No examinations yet" onRowClick={(r) => nav(`/app/cbt/exams/${r.id}`)}
        columns={[{ key: 't', header: 'Examination', primary: true, cell: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.subjectName ?? '—'}</p></div> }, { key: 'w', header: 'Window', cell: (r) => <span className="text-xs">{fmtDate(r.startsAt, true)} → {fmtDate(r.endsAt, true)}</span> }, { key: 'd', header: 'Duration', cell: (r) => `${r.durationMinutes} min` }, { key: 'q', header: 'Questions', cell: (r) => r.questionIds.length }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }]} />
    </>
  );
}

export function ExamEditor() {
  const { id = '' } = useParams();
  const toast = useToast();
  const nav = useNavigate();
  const { data: exam, loading } = useDocument<Exam>(C.exams, id);
  const questions = useCollection<BankQuestion>(C.questions, () => [], 'all');
  const subjects = useCollection<Subject>(C.subjects, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const students = useCollection<Student>(C.students, () => [], 'all');
  const [qSubject, setQSubject] = useState(''); const [qDiff, setQDiff] = useState(''); const [qSearch, setQSearch] = useState('');
  const [sel, setSel] = useState<Set<string> | null>(null); const [classSel, setClassSel] = useState<Set<string> | null>(null); const [stuSel, setStuSel] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [stuQ, setStuQ] = useState('');
  if (loading) return <Spinner />;
  if (!exam) return <EmptyState title="Examination not found" />;
  const published = exam.status !== 'draft';
  const picked = sel ?? new Set(exam.questionIds); const classes_ = classSel ?? new Set(exam.classIds); const stu_ = stuSel ?? new Set(exam.studentUids);
  const pool = questions.data.filter((q) => (!qSubject || q.subjectId === qSubject) && (!qDiff || q.difficulty === qDiff) && (!qSearch || `${q.prompt} ${q.topic}`.toLowerCase().includes(qSearch.toLowerCase())));
  const totalMarks = questions.data.filter((q) => picked.has(q.id)).reduce((s, q) => s + q.marks, 0);
  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };

  const saveAll = async (p: Record<string, unknown>) => {
    try {
      const subj = subjects.data.find((s) => s.id === p.subjectId);
      if (toDate(p.endsAt)! <= toDate(p.startsAt)!) throw new Error('The end time must be after the start time.');
      if (Number(p.questionCount) > picked.size) throw new Error('“Questions per attempt” cannot exceed the number of selected questions.');
      await patchDoc(C.exams, id, {
        title: p.title, subjectId: p.subjectId, subjectName: subj?.name ?? '', instructions: p.instructions, startsAt: p.startsAt, endsAt: p.endsAt, durationMinutes: Number(p.durationMinutes), passMark: Number(p.passMark),
        negativeMarking: { enabled: !!p.negEnabled, penalty: Number(p.negPenalty ?? 0) }, shuffleQuestions: !!p.shuffleQuestions, shuffleOptions: !!p.shuffleOptions, questionCount: Number(p.questionCount ?? 0), maxAttempts: Number(p.maxAttempts),
        releasePolicy: p.releasePolicy, questionIds: [...picked], classIds: [...classes_], studentUids: [...stu_], totalMarks,
      });
      toast.success('Examination saved');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };

  return (
    <>
      <PageHeader title={exam.title} description={`Status: ${exam.status}. ${published ? 'Unpublish to change questions or settings.' : 'Save your changes, then publish.'}`}
        actions={<><Link to="/app/cbt/exams"><Button variant="outline">← All</Button></Link>
          {exam.status === 'draft' && <Button variant="gold" loading={busy} onClick={() => void act(async () => { await patchDoc(C.exams, id, { questionIds: [...picked], classIds: [...classes_], studentUids: [...stu_], totalMarks }); await publishExam({ ...exam, id, questionIds: [...picked], classIds: [...classes_], studentUids: [...stu_] }); }, 'Published — visible to assigned students in their window')}>Publish</Button>}
          {exam.status === 'published' && <><Button variant="outline" loading={busy} onClick={() => void act(() => patchDoc(C.exams, id, { status: 'draft' }), 'Unpublished')}>Unpublish</Button><Button variant="outline" loading={busy} onClick={() => void act(() => patchDoc(C.exams, id, { status: 'closed' }), 'Closed')}>Close</Button></>}
          {exam.status === 'closed' && <Button variant="outline" onClick={() => void act(() => patchDoc(C.exams, id, { status: 'published' }), 'Re-opened')}>Re-open</Button>}
          <Button variant="ghost" onClick={() => { if (window.confirm('Delete this examination?')) void removeDoc(C.exams, id).then(() => nav('/app/cbt/exams')); }}>Delete</Button></>} />
      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <Card><CardHeader title="Settings" /><CardBody>
          <fieldset disabled={published} className={published ? 'opacity-60' : ''}>
            <EntityForm key={exam.id + exam.status} submitLabel="Save settings" initial={{ ...exam, negEnabled: exam.negativeMarking?.enabled, negPenalty: exam.negativeMarking?.penalty } as unknown as Record<string, unknown>} onSubmit={saveAll} fields={[
              { name: 'title', label: 'Title', type: 'text', required: true, span: 2 }, { name: 'subjectId', label: 'Subject', type: 'ref', required: true, ref: { collection: C.subjects, label: (r) => String(r.name) } },
              { name: 'durationMinutes', label: 'Duration (minutes)', type: 'number', required: true, min: 1, max: 600 }, { name: 'startsAt', label: 'Opens', type: 'datetime', required: true }, { name: 'endsAt', label: 'Closes (last start time)', type: 'datetime', required: true },
              { name: 'passMark', label: 'Pass mark (%)', type: 'number', required: true, min: 0, max: 100 }, { name: 'maxAttempts', label: 'Attempts allowed (1–5)', type: 'number', required: true, min: 1, max: 5 }, { name: 'questionCount', label: 'Questions per attempt (0 = all)', type: 'number', min: 0 },
              { name: 'releasePolicy', label: 'Release results', type: 'select', required: true, options: [{ value: 'immediate', label: 'Immediately after grading' }, { value: 'manual', label: 'When staff release them' }] },
              { name: 'negEnabled', label: 'Negative marking', type: 'checkbox' }, { name: 'negPenalty', label: 'Penalty (fraction of marks, e.g. 0.25)', type: 'number', min: 0, max: 1 },
              { name: 'shuffleQuestions', label: 'Shuffle question order', type: 'checkbox' }, { name: 'shuffleOptions', label: 'Shuffle answer options', type: 'checkbox' }, { name: 'instructions', label: 'Instructions shown before the exam', type: 'textarea', required: true }]} />
          </fieldset></CardBody></Card>
        <div className="space-y-5">
          <Card><CardHeader title="Assign to classes" /><CardBody className={`grid grid-cols-2 gap-2 ${published ? 'pointer-events-none opacity-60' : ''}`}>{classes.data.map((c) => <Checkbox key={c.id} label={c.name} checked={classes_.has(c.id)} onChange={() => toggle(classes_, c.id, setClassSel)} />)}{classes.data.length === 0 && <p className="text-sm text-muted">No classes yet.</p>}</CardBody></Card>
          <Card><CardHeader title="Or selected students" description="Only learners with a portal login." /><CardBody className={published ? 'pointer-events-none opacity-60' : ''}><Input aria-label="Search students" placeholder="Search…" value={stuQ} onChange={(e) => setStuQ(e.target.value)} />
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">{students.data.filter((s) => s.studentUid && `${s.firstName} ${s.lastName}`.toLowerCase().includes(stuQ.toLowerCase())).slice(0, 40).map((s) => <li key={s.id}><Checkbox label={`${s.firstName} ${s.lastName} (${s.className ?? '—'})`} checked={stu_.has(s.studentUid)} onChange={() => toggle(stu_, s.studentUid, setStuSel)} /></li>)}</ul></CardBody></Card>
        </div>
      </div>
      <Card className="mt-5"><CardHeader title={`Questions — ${picked.size} selected · ${totalMarks} marks`} description="Pick from the bank. Publishing snapshots them (without answers) for students." />
        <div className="flex flex-wrap gap-2 border-b border-line p-3"><Input aria-label="Search" className="max-w-56" placeholder="Search…" value={qSearch} onChange={(e) => setQSearch(e.target.value)} /><Select aria-label="Subject" className="w-auto" value={qSubject} onChange={(e) => setQSubject(e.target.value)}><option value="">All subjects</option>{subjects.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select><Select aria-label="Difficulty" className="w-auto" value={qDiff} onChange={(e) => setQDiff(e.target.value)}><option value="">Any difficulty</option>{DIFF.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</Select>
          {!published && <><Button size="sm" variant="outline" onClick={() => setSel(new Set([...picked, ...pool.map((q) => q.id)]))}>Select all shown</Button><Button size="sm" variant="outline" onClick={() => setSel(new Set())}>Clear</Button><Button size="sm" onClick={() => void patchDoc(C.exams, id, { questionIds: [...picked], totalMarks }).then(() => toast.success('Questions saved'))}>Save selection</Button></>}</div>
        {pool.length === 0 ? <EmptyState title="No questions match" description="Add questions in the Question bank." /> : <ul className={`max-h-96 divide-y divide-line overflow-y-auto ${published ? 'pointer-events-none opacity-60' : ''}`}>{pool.map((q) => <li key={q.id} className="px-4 py-2.5"><Checkbox label={<span><span className="line-clamp-1">{q.prompt}</span><span className="text-xs text-muted">{q.type} · {q.difficulty} · {q.marks} mk · {q.subjectName}</span></span>} checked={picked.has(q.id)} onChange={() => toggle(picked, q.id, setSel)} /></li>)}</ul>}</Card>
    </>
  );
}

/* ------------------------------------------------------- results & grading */
export function CbtResultsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const exams = useCollection<Exam>(C.exams, () => [], 'all');
  const [examId, setExamId] = useState('');
  const exam = exams.data.find((e) => e.id === examId);
  const attempts = useCollection<Attempt>(C.attempts, () => (examId ? [where('examId', '==', examId)] : null), examId);
  const results = useCollection<CbtResult>(C.cbtResults, () => (examId ? [where('examId', '==', examId)] : null), examId);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<{ result: WithId<CbtResult>; paper: Record<string, PaperQuestion>; answers: Record<string, string> } | null>(null);
  const stats = useMemo(() => { const r = results.data; if (!r.length) return null; const avg = r.reduce((s, x) => s + x.percentage, 0) / r.length; const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}`, count: 0 })); r.forEach((x) => { const b = buckets[Math.min(9, Math.floor(x.percentage / 10))]; if (b) b.count++; }); return { avg: Math.round(avg * 10) / 10, pass: Math.round((r.filter((x) => x.passed).length / r.length) * 100), high: Math.max(...r.map((x) => x.percentage)), low: Math.min(...r.map((x) => x.percentage)), buckets }; }, [results.data]);
  const ungraded = attempts.data.filter((a) => a.status === 'submitted' || (a.status === 'in_progress' && exam && Date.now() > (toDate(a.startedAt)?.getTime() ?? 0) + exam.durationMinutes * 60000 + 20000)).length;
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const openManual = async (r: WithId<CbtResult>) => {
    const a = attempts.data.find((x) => x.id === r.attemptId); if (!exam || !a) return;
    const { listDocs } = await import('@/services/db'); const paper = await listDocs<PaperQuestion>(`${C.exams}/${exam.id}/paper`);
    setManual({ result: r, paper: Object.fromEntries(paper.map((p) => [p.id, p])), answers: a.answers });
  };
  const exportCsv = () => downloadText(`${exam?.title ?? 'results'}.csv`, toCsv([['Student', 'Score', 'Total', 'Percentage', 'Passed', 'Pending manual', 'Released'], ...results.data.map((r) => [r.studentName, r.score, r.total, r.percentage, r.passed ? 'yes' : 'no', r.pendingManual, r.released ? 'yes' : 'no'])]));
  return (
    <>
      <PageHeader title="Results & grading" description="Objective questions are marked automatically; short answers flagged manual need your mark." />
      <Card className="mb-4"><CardBody className="flex flex-wrap items-end gap-3"><Field label="Examination" className="min-w-64">{(a) => <Select {...a} value={examId} onChange={(e) => setExamId(e.target.value)}><option value="">Select…</option>{exams.data.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}</Select>}</Field>
        {exam && <><Button loading={busy} variant="gold" onClick={() => void run(async () => { const n = await gradeExamAttempts(exam, profile?.displayName ?? ''); if (!n) throw new Error('Nothing new to grade.'); return n; }, 'Submissions graded')}>Grade {ungraded} submission(s)</Button>
          <Button variant="outline" onClick={() => void run(() => setReleased(results.data, true), 'Results released')} disabled={!results.data.length}><Eye className="h-4 w-4" /> Release all</Button><Button variant="outline" onClick={() => void run(() => setReleased(results.data, false), 'Results hidden')} disabled={!results.data.length}><EyeOff className="h-4 w-4" /> Hide all</Button><Button variant="outline" onClick={exportCsv} disabled={!results.data.length}><Download className="h-4 w-4" /> CSV</Button></>}</CardBody></Card>
      {!exam ? <Card><EmptyState title="Select an examination" /></Card> : (<>
        {stats && <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Average" value={`${stats.avg}%`} /><StatCard label="Pass rate" value={`${stats.pass}%`} tone="ok" /><StatCard label="Highest" value={`${stats.high}%`} tone="gold" /><StatCard label="Lowest" value={`${stats.low}%`} tone="danger" /></div>}
        {stats && <Card className="mb-5"><CardHeader title="Score distribution" /><CardBody><div className="h-56"><ResponsiveContainer><BarChart data={stats.buckets}><CartesianGrid stroke="#e6e3d9" vertical={false} /><XAxis dataKey="range" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#0B3D2E" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></CardBody></Card>}
        <Card><CardHeader title={`${attempts.data.length} attempt(s)`} /><TableWrap><thead><tr><Th>Student</Th><Th>Attempt</Th><Th>Status</Th><Th>Score</Th><Th>%</Th><Th>Result</Th><Th>Visible</Th><Th /></tr></thead><tbody>{attempts.data.map((a) => { const r = results.data.find((x) => x.attemptId === a.id); return (
          <tr key={a.id}><Td className="font-medium">{a.studentName}</Td><Td>#{a.attemptNo}</Td><Td><StatusBadge status={a.status} />{a.autoSubmitted && <Badge className="ml-1">auto</Badge>}</Td><Td>{r ? `${r.score}/${r.total}` : '—'}</Td><Td>{r?.percentage ?? '—'}</Td><Td>{r ? <Badge tone={r.passed ? 'ok' : 'danger'}>{r.passed ? 'pass' : 'fail'}</Badge> : '—'}{r && r.pendingManual > 0 && <Badge tone="warn" className="ml-1">{r.pendingManual} to mark</Badge>}</Td><Td>{r ? (r.released ? 'yes' : 'no') : '—'}</Td>
            <Td className="text-right">{r && r.pendingManual > 0 && <Button size="sm" variant="outline" onClick={() => void openManual(r)}>Mark</Button>}{r && <Button size="sm" variant="ghost" onClick={() => void run(() => setReleased([r], !r.released), r.released ? 'Hidden' : 'Released')}>{r.released ? 'Hide' : 'Release'}</Button>}</Td></tr>); })}</tbody></TableWrap></Card></>)}
      <Dialog open={!!manual} onClose={() => setManual(null)} title="Manual marking" description={manual?.result.studentName} size="lg">
        {manual && <ul className="space-y-4">{manual.result.outcomes.filter((o) => o.status === 'pending' || manual.result.manualMarks?.[o.questionId] !== undefined).map((o) => { const q = manual.paper[o.questionId]; let val = String(manual.result.manualMarks?.[o.questionId] ?? ''); return (
          <li key={o.questionId} className="rounded-md border border-line p-3"><p className="text-sm font-medium">{q?.prompt}</p><p className="my-2 rounded bg-cream p-2 text-sm">{manual.answers[o.questionId] || <em className="text-muted">No answer</em>}</p>
            <div className="flex items-end gap-2"><Field label={`Mark (max ${o.max})`}>{(a) => <Input {...a} className="w-28" type="number" min={0} max={o.max} defaultValue={val} onChange={(e) => { val = e.target.value; }} />}</Field><Button size="sm" onClick={() => { const m = Number(val); if (Number.isNaN(m) || m < 0 || m > o.max) return toast.error(`Enter 0–${o.max}`); void run(() => applyManualMark(exam!, manual.result, o.questionId, m, profile?.displayName ?? ''), 'Mark saved').then(() => setManual(null)); }}>Save mark</Button></div></li>); })}</ul>}
      </Dialog>
    </>
  );
}

export function CbtOverview() {
  const exams = useCollection<Exam>(C.exams, () => [], 'all');
  const qs = useCollection<BankQuestion>(C.questions, () => [], 'all');
  const results = useCollection<CbtResult>(C.cbtResults, () => [], 'all');
  const avg = results.data.length ? Math.round(results.data.reduce((s, r) => s + r.percentage, 0) / results.data.length) : 0;
  return (<><PageHeader title="CBT overview" />
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><StatCard label="Examinations" value={exams.data.length} hint={`${exams.data.filter((e) => e.status === 'published').length} published`} /><StatCard label="Question bank" value={qs.data.length} tone="gold" /><StatCard label="Graded attempts" value={results.data.length} /><StatCard label="Average score" value={`${avg}%`} tone="ok" /></div>
    <Card className="mt-6"><CardHeader title="Quick actions" /><CardBody className="flex flex-wrap gap-2"><Link to="/app/cbt/exams"><Button variant="outline">Examinations</Button></Link><Link to="/app/cbt/questions"><Button variant="outline">Question bank</Button></Link><Link to="/app/cbt/results"><Button variant="outline">Grade & release results</Button></Link></CardBody></Card></>);
}
