import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { Award, ExternalLink, Printer, Trash2 } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Badge, EmptyState, Progress, Spinner, StatusBadge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { useSessions } from '@/features/schedule/useSessions';
import { C } from '@/config/collections';
import { BRAND } from '@/config/brand';
import { can } from '@/config/permissions';
import { SITE_URL } from '@/config/env';
import { createDoc, getById, listDocs, patchDoc, replaceDoc } from '@/services/db';
import { issueCertificate } from '@/services/lms';
import { notifyUsers } from '@/services/notifications';
import { UPLOADS_OFF_MESSAGE, deleteFileRef, signedUrlFor, uploadFor } from '@/services/files';
import { flags } from '@/config/env';
import type { FileRef } from '@/lib/fileRef';
import { gradeAttempt, type AnswerKey, type PaperQuestion } from '@/lib/cbt/grade';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';
import type { Assignment_, Course, CourseEnrollment, WithId } from './types';

type Row = Record<string, unknown> & { id: string };
interface QuizQ { id: string; type: 'mcq' | 'tf' | 'short'; prompt: string; options: { id: string; text: string }[]; marks: number }

/* ------------------------------------------------------------------ quizzes */
export function QuizTake({ quiz, onClose }: { quiz: Row; onClose: () => void }) {
  const { uid } = useAuth();
  const toast = useToast();
  const questions = (quiz.questions as QuizQ[]) ?? [];
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ score: number; total: number; passed: boolean; keys: Record<string, { correct?: string; accepted?: string[]; explanation?: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!uid) return;
    setBusy(true);
    try {
      const attemptId = `${quiz.id}_${uid}`;
      // 1) store the answers (this unlocks reading the key, per security rules)
      await replaceDoc(C.quizAttempts, attemptId, { quizId: quiz.id, uid, answers, submittedAt: new Date(), parentUids: [] });
      const keyDoc = await getById<{ answers: Record<string, { correct?: string; accepted?: string[]; explanation?: string }> }>(C.quizKeys, String(quiz.id));
      const keys = keyDoc?.answers ?? {};
      const g = gradeAttempt({ questions: questions as PaperQuestion[], keys: keys as Record<string, AnswerKey>, answers, config: { negativeMarking: { enabled: false, penalty: 0 }, passMark: Number(quiz.passMark ?? 50) } });
      await patchDoc(C.quizAttempts, attemptId, { score: g.score, total: g.total, percentage: g.percentage, passed: g.passed });
      setResult({ score: g.score, total: g.total, passed: g.passed, keys });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title={String(quiz.title)} description="Practice quiz — your score is shown after you submit." size="lg" footer={result ? <Button onClick={onClose}>Close</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Submit answers</Button></>}>
      {result && <div role="status" className={`mb-4 rounded-md p-4 text-center ${result.passed ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn'}`}><p className="font-heading text-2xl font-semibold">{result.score} / {result.total}</p><p className="text-sm">{result.passed ? 'Well done — you passed!' : 'Keep practising — you can retake this quiz.'}</p></div>}
      <ol className="space-y-6">{questions.map((q, i) => (
        <li key={q.id}><p className="font-medium">{i + 1}. {q.prompt} <span className="text-xs text-muted">({q.marks} mark{q.marks === 1 ? '' : 's'})</span></p>
          <div className="mt-2 space-y-1.5">
            {q.type === 'short' ? <Input aria-label={`Answer ${i + 1}`} disabled={!!result} value={answers[q.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} /> :
              (q.type === 'tf' ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] : q.options).map((o) => {
                const k = result?.keys[q.id]; const right = result && k?.correct === o.id; const wrong = result && answers[q.id] === o.id && k?.correct !== o.id;
                return <label key={o.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${right ? 'border-ok bg-ok-bg' : wrong ? 'border-danger bg-danger-bg' : 'border-line'}`}><input type="radio" name={q.id} disabled={!!result} checked={answers[q.id] === o.id} onChange={() => setAnswers({ ...answers, [q.id]: o.id })} className="accent-forest-700" />{o.text}</label>;
              })}
            {result?.keys[q.id]?.explanation && <p className="text-xs text-muted">Explanation: {result.keys[q.id]!.explanation}</p>}
            {result && q.type === 'short' && <p className="text-xs text-muted">Accepted: {(result.keys[q.id]?.accepted ?? []).join(', ')}</p>}
          </div></li>))}</ol>
    </Dialog>
  );
}

function QuizBuilder({ quiz, onClose }: { quiz: (Row & { questions?: QuizQ[] }) | null; onClose: () => void }) {
  const { uid } = useAuth();
  const toast = useToast();
  const courses = useCollection<Course>(C.courses, () => [], 'all');
  const [title, setTitle] = useState(String(quiz?.title ?? '')); const [courseId, setCourseId] = useState(String(quiz?.courseId ?? '')); const [passMark, setPassMark] = useState(String(quiz?.passMark ?? 50));
  const [qs, setQs] = useState<{ id: string; type: QuizQ['type']; prompt: string; optionsText: string; correct: string; marks: string; explanation: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!quiz) return; setTitle(String(quiz.title)); setCourseId(String(quiz.courseId ?? '')); setPassMark(String(quiz.passMark ?? 50));
    void getById<{ answers: Record<string, { correct?: string; accepted?: string[]; explanation?: string }> }>(C.quizKeys, quiz.id).then((k) => {
      setQs(((quiz.questions as QuizQ[]) ?? []).map((q) => { const a = k?.answers?.[q.id]; return { id: q.id, type: q.type, prompt: q.prompt, optionsText: q.options.map((o) => o.text).join('\n'), correct: q.type === 'mcq' ? String(Math.max(0, q.options.findIndex((o) => o.id === a?.correct)) + 1) : q.type === 'tf' ? a?.correct ?? 'true' : (a?.accepted ?? []).join('|'), marks: String(q.marks), explanation: a?.explanation ?? '' }; })); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [quiz?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const add = () => setQs([...qs, { id: `q${Date.now()}`, type: 'mcq', prompt: '', optionsText: '', correct: '1', marks: '1', explanation: '' }]);
  const save = async () => {
    try {
      if (!title.trim() || !courseId || qs.length === 0) throw new Error('Title, course and at least one question are required.');
      const questions: QuizQ[] = []; const answers: Record<string, { correct?: string; accepted?: string[]; explanation?: string }> = {};
      qs.forEach((q, i) => {
        if (!q.prompt.trim()) throw new Error(`Question ${i + 1} has no text.`);
        const options = q.type === 'mcq' ? q.optionsText.split('\n').map((s) => s.trim()).filter(Boolean).map((text, k) => ({ id: `o${k + 1}`, text })) : [];
        if (q.type === 'mcq' && (options.length < 2 || !options[Number(q.correct) - 1])) throw new Error(`Question ${i + 1}: add ≥2 options and a valid correct option number.`);
        questions.push({ id: q.id, type: q.type, prompt: q.prompt.trim(), options, marks: Number(q.marks) || 1 });
        answers[q.id] = { ...(q.type === 'mcq' ? { correct: `o${q.correct}` } : q.type === 'tf' ? { correct: q.correct === 'false' ? 'false' : 'true' } : { accepted: q.correct.split('|').map((s) => s.trim()).filter(Boolean) }), ...(q.explanation ? { explanation: q.explanation } : {}) };
      });
      const id = quiz?.id ?? await createDoc(C.quizzes, { title, courseId, passMark: Number(passMark), questions, createdBy: uid ?? '' });
      if (quiz) await patchDoc(C.quizzes, id, { title, courseId, passMark: Number(passMark), questions });
      await replaceDoc(C.quizKeys, id, { answers });
      toast.success('Quiz saved'); onClose();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  if (quiz && !loaded) return <Dialog open onClose={onClose} title="Loading…"><Spinner /></Dialog>;
  return (
    <Dialog open onClose={onClose} title={quiz ? 'Edit quiz' : 'New quiz'} size="xl" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void save()}>Save quiz</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3"><Field label="Title" required className="sm:col-span-2">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field><Field label="Pass mark %">{(a) => <Input {...a} type="number" value={passMark} onChange={(e) => setPassMark(e.target.value)} />}</Field>
        <Field label="Course" required className="sm:col-span-3">{(a) => <Select {...a} value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">Select…</option>{courses.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field></div>
      <div className="mt-5 space-y-4">{qs.map((q, i) => (
        <Card key={q.id}><CardBody className="grid gap-3 sm:grid-cols-4"><Field label={`Question ${i + 1}`} className="sm:col-span-3">{(a) => <Input {...a} value={q.prompt} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, prompt: e.target.value } : x)))} />}</Field>
          <Field label="Type">{(a) => <Select {...a} value={q.type} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, type: e.target.value as QuizQ['type'], correct: e.target.value === 'mcq' ? '1' : e.target.value === 'tf' ? 'true' : '' } : x)))}><option value="mcq">Multiple choice</option><option value="tf">True / false</option><option value="short">Short answer</option></Select>}</Field>
          {q.type === 'mcq' && <Field label="Options (one per line)" className="sm:col-span-2">{(a) => <Textarea {...a} value={q.optionsText} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, optionsText: e.target.value } : x)))} />}</Field>}
          <Field label={q.type === 'mcq' ? 'Correct option number' : q.type === 'tf' ? 'Correct' : 'Accepted answers (separate with |)'} className={q.type === 'mcq' ? '' : 'sm:col-span-2'}>{(a) => q.type === 'tf' ? <Select {...a} value={q.correct} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, correct: e.target.value } : x)))}><option value="true">True</option><option value="false">False</option></Select> : <Input {...a} value={q.correct} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, correct: e.target.value } : x)))} />}</Field>
          <Field label="Marks">{(a) => <Input {...a} type="number" value={q.marks} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, marks: e.target.value } : x)))} />}</Field>
          <Field label="Explanation (shown after submit)" className="sm:col-span-3">{(a) => <Input {...a} value={q.explanation} onChange={(e) => setQs(qs.map((x) => (x.id === q.id ? { ...x, explanation: e.target.value } : x)))} />}</Field>
          <div className="flex items-end justify-end"><Button variant="ghost" aria-label="Remove question" onClick={() => setQs(qs.filter((x) => x.id !== q.id))}><Trash2 className="h-4 w-4 text-danger" /></Button></div></CardBody></Card>))}</div>
      <Button className="mt-4" variant="outline" onClick={add}>+ Add question</Button>
    </Dialog>
  );
}

export function QuizzesPage() {
  const { role, uid } = useAuth();
  const manage = can(role, 'lms.manage');
  const [builder, setBuilder] = useState<(Row & { questions?: QuizQ[] }) | 'new' | null>(null);
  const [take, setTake] = useState<Row | null>(null);
  const enr = useCollection<CourseEnrollment>(C.courseEnrollments, () => (uid && role === 'student' ? [where('uid', '==', uid)] : null), `${uid}${role}`);
  const all = useCollection<Row>(C.quizzes, () => (manage ? [] : null), role ?? '');
  const [mine, setMine] = useState<Row[]>([]);
  const att = useCollection<{ quizId: string; percentage?: number; passed?: boolean }>(C.quizAttempts, () => (uid && role === 'student' ? [where('uid', '==', uid)] : null), `${uid}${role}`);
  useEffect(() => { if (role !== 'student') return; void Promise.all(enr.data.map((e) => listDocs<Row>(C.quizzes, [where('courseId', '==', e.courseId)]))).then((l) => setMine(l.flat())).catch(() => undefined); }, [enr.data, role]);
  const rows = manage ? all.data : mine;
  return (
    <>
      <PageHeader title="Quizzes" description={manage ? 'Practice quizzes with automatic grading. For assessed, timed examinations use CBT.' : 'Practice quizzes from your courses.'} actions={manage && <Button onClick={() => setBuilder('new')}>New quiz</Button>} />
      {rows.length === 0 ? <Card><EmptyState title="No quizzes yet" /></Card> : <div className="grid gap-4 md:grid-cols-2">{rows.map((q) => { const a = att.data.find((x) => x.quizId === q.id); return (
        <Card key={q.id}><CardBody className="flex items-start justify-between gap-3"><div><p className="font-medium">{String(q.title)}</p><p className="text-xs text-muted">{((q.questions as unknown[]) ?? []).length} questions · pass mark {String(q.passMark ?? 50)}%</p>{a && <p className="mt-1 text-xs">Last score: <strong>{a.percentage ?? '—'}%</strong> {a.passed ? <Badge tone="ok">passed</Badge> : <Badge tone="warn">retry</Badge>}</p>}</div>
          {manage ? <Button size="sm" variant="outline" onClick={() => setBuilder(q as Row & { questions?: QuizQ[] })}>Edit</Button> : <Button size="sm" onClick={() => setTake(q)}>{a ? 'Retake' : 'Start'}</Button>}</CardBody></Card>); })}</div>}
      {builder && <QuizBuilder quiz={builder === 'new' ? null : builder} onClose={() => setBuilder(null)} />}
      {take && <QuizTake quiz={take} onClose={() => setTake(null)} />}
    </>
  );
}

/* -------------------------------------------------------------- assignments */
export function LmsAssignmentsPage() {
  const { role } = useAuth();
  return role === 'student' ? <StudentAssignments /> : <StaffAssignments />;
}

function StaffAssignments() {
  const { uid, profile, role } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState<Row | null>(null);
  const subs = useCollection<Row>(C.submissions, () => (open ? [where('assignmentId', '==', open.id)] : null), open?.id ?? '');
  const [grade, setGrade] = useState<Record<string, { score: string; feedback: string }>>({});
  const manage = can(role, 'lms.manage');
  const config: CrudConfig<Row> = {
    collection: C.assignments, singular: 'Assignment', plural: 'Assignments', description: 'Create assignments, receive submissions and grade with feedback.', canCreate: manage, canEdit: manage, canDelete: manage, auditActions: true,
    rowFilter: (r) => (role === 'teacher' ? r.teacherUid === uid : true),
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, span: 2 }, { name: 'instructions', label: 'Instructions', type: 'textarea', required: true },
      { name: 'courseId', label: 'Course', type: 'ref', ref: { collection: C.courses, label: (r) => String(r.title) } }, { name: 'classId', label: 'Class (optional)', type: 'ref', ref: { collection: C.classes, label: (r) => String(r.name) } },
      { name: 'dueAt', label: 'Deadline', type: 'datetime', required: true }, { name: 'maxScore', label: 'Maximum score', type: 'number', required: true, min: 1, defaultValue: 100 },
      { name: 'allowText', label: 'Allow text submission', type: 'checkbox', defaultValue: true }, { name: 'allowFile', label: 'Allow file submission', type: 'checkbox', defaultValue: true },
    ],
    beforeSave: (p, e) => { if (!p.courseId && !p.classId) throw new Error('Choose a course or a class for this assignment.'); return e ? p : { ...p, teacherUid: uid ?? '', teacherName: profile?.displayName ?? '' }; },
    columns: [{ key: 't', header: 'Assignment', primary: true, cell: (r) => <span className="font-medium">{String(r.title)}</span> }, { key: 'd', header: 'Deadline', cell: (r) => fmtDate(r.dueAt, true) }, { key: 'm', header: 'Max', cell: (r) => String(r.maxScore) }],
    searchKeys: ['title'], sort: (a, b) => (toDate(b.dueAt)?.getTime() ?? 0) - (toDate(a.dueAt)?.getTime() ?? 0),
    rowActions: (r) => <Button size="sm" variant="outline" onClick={() => setOpen(r)}>Submissions</Button>,
  };
  const save = async (s: Row) => {
    const g = grade[s.id]; if (!g) return;
    const score = Number(g.score); if (Number.isNaN(score) || score < 0 || score > Number(open?.maxScore)) return toast.error(`Score must be between 0 and ${String(open?.maxScore)}.`);
    try { await patchDoc(C.submissions, s.id, { score, feedback: g.feedback, status: 'graded', gradedAt: new Date(), gradedBy: profile?.displayName ?? '' }); void notifyUsers([String(s.uid)], { title: `Assignment graded: ${String(open?.title)}`, link: '/app/lms/assignments' }); toast.success('Graded'); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <CrudPage config={config} />
      <Dialog open={!!open} onClose={() => setOpen(null)} title="Submissions" description={String(open?.title ?? '')} size="xl">
        {subs.loading ? <Spinner /> : subs.data.length === 0 ? <EmptyState title="No submissions yet" /> : <ul className="space-y-4">{subs.data.map((s) => (
          <li key={s.id} className="rounded-md border border-line p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{String(s.studentName)}</p><StatusBadge status={String(s.status)} /></div>
            <p className="text-xs text-muted">Submitted {fmtDate(s.submittedAt, true)}{toDate(s.submittedAt) && toDate(open?.dueAt) && toDate(s.submittedAt)! > toDate(open?.dueAt)! ? ' · LATE' : ''}</p>
            {Boolean(s.text) && <p className="mt-2 whitespace-pre-wrap rounded bg-cream p-3 text-sm">{String(s.text)}</p>}<SubmissionFile s={s} />
            <div className="mt-3 flex flex-wrap items-end gap-2"><Field label={`Score /${String(open?.maxScore)}`}>{(a) => <Input {...a} className="w-24" type="number" defaultValue={s.score as number | undefined} onChange={(e) => setGrade({ ...grade, [s.id]: { score: e.target.value, feedback: grade[s.id]?.feedback ?? String(s.feedback ?? '') } })} />}</Field>
              <Field label="Feedback" className="min-w-52 flex-1">{(a) => <Input {...a} defaultValue={String(s.feedback ?? '')} onChange={(e) => setGrade({ ...grade, [s.id]: { score: grade[s.id]?.score ?? String(s.score ?? ''), feedback: e.target.value } })} />}</Field><Button onClick={() => void save(s)}>Save grade</Button></div></li>))}</ul>}
      </Dialog>
    </>
  );
}

function StudentAssignments() {
  const { uid, profile, roles } = useAuth();
  const toast = useToast();
  const enr = useCollection<CourseEnrollment>(C.courseEnrollments, () => (uid ? [where('uid', '==', uid)] : null), uid ?? '');
  const subs = useCollection<Row>(C.submissions, () => (uid ? [where('uid', '==', uid)] : null), uid ?? '');
  const [list, setList] = useState<WithId<Assignment_>[]>([]);
  const [sel, setSel] = useState<WithId<Assignment_> | null>(null);
  const [text, setText] = useState(''); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void (async () => {
      const lists = await Promise.all([
        ...(profile?.classId ? [listDocs<Assignment_>(C.assignments, [where('classId', '==', profile.classId)])] : []),
        ...enr.data.map((e) => listDocs<Assignment_>(C.assignments, [where('courseId', '==', e.courseId)])),
      ]).catch(() => [] as WithId<Assignment_>[][]);
      const m = new Map<string, WithId<Assignment_>>(); lists.flat().forEach((a) => m.set(a.id, a)); setList([...m.values()].sort((a, b) => (toDate(a.dueAt)?.getTime() ?? 0) - (toDate(b.dueAt)?.getTime() ?? 0)));
    })();
  }, [enr.data, profile?.classId]);
  const submit = async () => {
    if (!sel || !uid || !profile) return;
    if (!text.trim() && !file) return toast.error('Write an answer or attach a file.');
    setBusy(true);
    try {
      const before = subOf(sel.id) as { fileRef?: FileRef; fileName?: string; fileUrl?: string } | undefined;
      let fileRef: FileRef | null = before?.fileRef ?? null; let fileName = before?.fileName ?? ''; let fileUrl = before?.fileUrl ?? '';
      if (file) {
        if (!flags.uploads) throw new Error(UPLOADS_OFF_MESSAGE);
        fileRef = await uploadFor('submission', file, roles, { assignmentId: sel.id }); fileName = file.name; fileUrl = '';
      }
      await replaceDoc(C.submissions, `${sel.id}_${uid}`, { assignmentId: sel.id, uid, studentName: profile.displayName, parentUids: [], text: text.trim(), fileUrl, fileRef, fileName, status: 'submitted', submittedAt: new Date() });
      // replacing a file: remove the old private copy only after the new submission is saved
      if (file && before?.fileRef?.provider === 'supabase') void deleteFileRef(before.fileRef).catch(() => undefined);
      toast.success('Submitted'); setSel(null); setText(''); setFile(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const subOf = (id: string) => subs.data.find((s) => s.assignmentId === id);
  return (
    <>
      <PageHeader title="Assignments" description="Submit work before the deadline and read your feedback." />
      {list.length === 0 ? <Card><EmptyState title="No assignments" description="Assignments from your classes and courses appear here." /></Card> : <div className="space-y-3">{list.map((a) => { const s = subOf(a.id); const late = toDate(a.dueAt) && toDate(a.dueAt)! < new Date(); return (
        <Card key={a.id}><CardBody className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-medium">{a.title}</p><p className="mt-1 text-sm text-muted line-clamp-2">{a.instructions}</p><p className="mt-1 text-xs text-muted">Due {fmtDate(a.dueAt, true)} {late && !s ? <Badge tone="danger">overdue</Badge> : null}</p>
          {s?.status === 'graded' && <p className="mt-2 text-sm"><strong>{String(s.score)}</strong> / {a.maxScore} — {String(s.feedback ?? '')}</p>}</div>
          <div className="flex items-center gap-2">{s && <StatusBadge status={String(s.status)} />}{(!s || s.status !== 'graded') && <Button size="sm" onClick={() => { setSel(a); setText(String(s?.text ?? '')); setFile(null); }}>{s ? 'Resubmit' : 'Submit'}</Button>}</div></CardBody></Card>); })}</div>}
      <Dialog open={!!sel} onClose={() => setSel(null)} title={sel?.title ?? ''} description={`Due ${fmtDate(sel?.dueAt, true)}`} footer={<><Button variant="outline" onClick={() => setSel(null)}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Submit</Button></>}>
        <p className="mb-4 whitespace-pre-wrap text-sm">{sel?.instructions}</p>
        {sel?.allowText !== false && <Field label="Your answer">{(a) => <Textarea {...a} rows={6} value={text} onChange={(e) => setText(e.target.value)} />}</Field>}
        {sel?.allowFile !== false && <div className="mt-3"><Button variant="outline" onClick={() => fileRef.current?.click()}>{file ? file.name : 'Attach a file'}</Button><input ref={fileRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>}
      </Dialog>
    </>
  );
}

/* -------------------------------------------------------------- certificates */
export function CertificatesPage() {
  const { role, uid, profile } = useAuth();
  const toast = useToast();
  const staff = can(role, 'lms.manage');
  const enr = useCollection<CourseEnrollment>(
    C.courseEnrollments,
    () => (staff ? [where('status', '==', 'completed')] : null),
    `${staff}`
  );
  const certs = useCollection<{
    code: string;
    courseTitle: string;
    studentName: string;
    issuedAt: unknown;
    uid: string;
  }>(
    C.certificates,
    () => (
      staff
        ? []
        : uid
          ? [
              role === 'parent'
                ? where('parentUids', 'array-contains', uid)
                : where('uid', '==', uid)
            ]
          : null
    ),
    `${role}${uid}`
  );

  const [view, setView] = useState<(typeof certs.data)[number] | null>(null);

  const pending = enr.data.filter(
    (e) =>
      !certs.data.some(
        (c) => c.uid === e.uid && c.courseTitle === e.courseTitle
      )
  );

  return (
    <>
      <PageHeader
        title="Certificates"
        description="Verifiable course certificates. Anyone can verify a code on the public website."
      />

      {staff && pending.length > 0 && (
        <Card className="mb-5">
          <CardHeader
            title={`${pending.length} completed course(s) awaiting a certificate`}
          />
          <ul className="divide-y divide-line">
            {pending.map((e) => (
              <li
                key={`${e.uid}-${e.courseTitle}`}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span>
                  {e.studentName} — {e.courseTitle}
                </span>
                <Button
                  size="sm"
                  variant="gold"
                  onClick={() => {
                    void issueCertificate(
                      e,
                      profile?.displayName ?? ''
                    )
                      .then((c) => toast.success(`Issued ${c}`))
                      .catch((x) => toast.error(errorMessage(x)));
                  }}
                >
                  Issue
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {certs.loading ? (
        <Spinner />
      ) : certs.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No certificates yet"
            icon={<Award className="h-6 w-6" />}
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {certs.data.map((c) => (
            <Card key={c.code}>
              <CardBody className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{c.courseTitle}</p>
                  <p className="text-xs text-muted">
                    {c.studentName} · {fmtDate(c.issuedAt)} · {c.code}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setView(c)}
                >
                  View
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!view}
        onClose={() => setView(null)}
        title="Certificate"
        size="lg"
        footer={
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print / Save PDF
          </Button>
        }
      >
        {view && (
          <div className="print-area border-8 border-double border-gold-400 p-8 text-center">
            <img src={BRAND.logo} alt="" className="mx-auto h-20" />
            <p className="mt-3 font-heading text-sm uppercase tracking-[0.3em] text-gold-600">
              Certificate of completion
            </p>
            <p className="mt-6 text-sm">This certifies that</p>
            <p className="font-heading text-3xl font-semibold text-forest-700">
              {view.studentName}
            </p>
            <p className="mt-2 text-sm">has successfully completed</p>
            <p className="font-heading text-xl font-semibold">
              {view.courseTitle}
            </p>
            <p className="mt-6 text-xs text-muted">
              Issued {fmtDate(view.issuedAt)} · {BRAND.name}
            </p>
            <p className="mt-1 text-xs">
              Verify: {SITE_URL}/verify/{view.code}
            </p>
            <p className="font-mono text-sm">{view.code}</p>
          </div>
        )}
      </Dialog>
    </>
  );
}

export function ProgressPage() {
  const { uid } = useAuth();

  const { data, loading } = useCollection<CourseEnrollment>(
    C.courseEnrollments,
    () => (
      uid ? [where('parentUids', 'array-contains', uid)] : null
    ),
    uid ?? ''
  );

  const by = useMemo(() => {
    const m = new Map<string, CourseEnrollment[]>();

    data.forEach((e) =>
      m.set(e.studentName, [
        ...(m.get(e.studentName) ?? []),
        e
      ])
    );

    return [...m.entries()];
  }, [data]);

  return (
    <>
      <PageHeader
        title="Learning progress"
        description="Read-only view of your children’s courses."
      />

      {loading ? (
        <Spinner />
      ) : by.length === 0 ? (
        <Card>
          <EmptyState title="No course activity yet" />
        </Card>
      ) : (
        by.map(([n, list]) => (
          <Card key={n} className="mb-4">
            <CardHeader title={n} />
            <ul className="divide-y divide-line">
              {list.map((e) => (
                <li
                  key={`${e.uid}-${e.courseTitle}`}
                  className="p-4"
                >
                  <div className="flex justify-between text-sm">
                    <span>{e.courseTitle}</span>
                    <span>{e.progressPct}%</span>
                  </div>
                  <Progress
                    className="mt-2"
                    value={e.progressPct}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </>
  );
}

export function LmsOverview() {
  const { role, uid } = useAuth();

  const staff = can(role, 'lms.manage') || role === 'director';

  const courses = useCollection<Course>(
    C.courses,
    () => (staff ? [] : null),
    `${staff}`
  );

  const enr = useCollection<CourseEnrollment>(
    C.courseEnrollments,
    () => (
      staff
        ? []
        : uid
          ? [
              role === 'parent'
                ? where('parentUids', 'array-contains', uid)
                : where('uid', '==', uid)
            ]
          : null
    ),
    `${role}${uid}`
  );

  // Live classes now come from the timetable (sessions). Meeting URLs are never read here.
  const seeAll = role === 'super_admin' || role === 'admin' || role === 'principal' || role === 'director';
  const horizon = useMemo(() => { const t = new Date(); const n = new Date(t.getTime() + 35 * 86_400_000); return [t.toISOString().slice(0, 10), n.toISOString().slice(0, 10)]; }, []);
  const live = useSessions(horizon, uid, seeAll);
  const upcoming = live.sessions
    .filter((l) => l.online && l.status === 'scheduled' && (toDate(l.endAt)?.getTime() ?? 0) > Date.now())
    .sort((a, b) => (toDate(a.startAt)?.getTime() ?? 0) - (toDate(b.startAt)?.getTime() ?? 0));

  const avg = enr.data.length
    ? Math.round(
        enr.data.reduce((s, e) => s + e.progressPct, 0) /
          enr.data.length
      )
    : 0;

  return (
    <>
      <PageHeader title="Learning overview" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {staff && (
          <StatCard
            label="Courses"
            value={courses.data.length}
            hint={`${courses.data.filter((c) => c.status === 'published').length} published`}
          />
        )}

        <StatCard
          label="Enrolments"
          value={enr.data.length}
          tone="gold"
        />

        <StatCard
          label="Average progress"
          value={`${avg}%`}
        />

        <StatCard
          label="Upcoming live classes"
          value={upcoming.length}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Next live classes" />

        {upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled" />
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.slice(0, 5).map((l) => (
              <li
                key={l.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <span>
                  <span className="font-medium">{l.title}</span>
                  <span className="block text-xs text-muted">
                    {fmtDate(l.startAt, true)}
                  </span>
                </span>

                <Link to="/app/lms/live">
                  <Button size="sm" variant="outline">
                    Open
                  </Button>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/** Opens a student's submitted file. Private files are fetched through a short-lived signed link. */
function SubmissionFile({ s }: { s: { id: string; fileUrl?: unknown; fileName?: unknown; fileRef?: unknown } }) {
  const toast = useToast();
  const ref = s.fileRef as FileRef | undefined;
  const label = String(s.fileName || 'Open file');
  if (ref?.provider === 'supabase') {
    return <Button size="sm" variant="outline" className="mt-2" onClick={() => { const w = window.open('', '_blank'); void signedUrlFor('submissions', s.id).then((u) => { if (u && w) w.location.href = u; else { w?.close(); toast.error('Could not open this file. Try again.'); } }); }}><ExternalLink className="h-3.5 w-3.5" /> {label}</Button>;
  }
  if (!s.fileUrl) return null;
  return <a className="mt-2 inline-flex items-center gap-1 text-sm text-forest-500 underline" href={String(s.fileUrl)} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3.5 w-3.5" />{label}</a>;
}
