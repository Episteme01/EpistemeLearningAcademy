import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { Check, Clock, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Badge, EmptyState, Spinner } from '@/components/ui/data';
import { ConfirmDialog, useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { listDocs } from '@/services/db';
import { GRACE_MS, deadlineMs, logEvent, saveProgress, startOrResumeAttempt, submitAttempt } from '@/services/cbt';
import { seededShuffle } from '@/lib/cbt/shuffle';
import { cn, errorMessage, fmtDate, toDate } from '@/lib/utils';
import type { Attempt, CbtResult, Exam, PaperQuestion, WithId } from '@/types/models';

/** Exams visible to the signed-in learner. Two provable queries (by class, by student) merged. */
function useMyExams() {
  const { uid, profile } = useAuth();
  const cid = profile?.classId;
  const byClass = useCollection<Exam>(C.exams, () => (cid ? [where('status', '==', 'published'), where('classIds', 'array-contains', cid)] : null), cid ?? '');
  const byStudent = useCollection<Exam>(C.exams, () => (uid ? [where('status', '==', 'published'), where('studentUids', 'array-contains', uid)] : null), uid ?? '');
  const map = new Map<string, WithId<Exam>>(); [...byClass.data, ...byStudent.data].forEach((e) => map.set(e.id, e));
  return { exams: [...map.values()].sort((a, b) => (toDate(a.startsAt)?.getTime() ?? 0) - (toDate(b.startsAt)?.getTime() ?? 0)), loading: byClass.loading || byStudent.loading, error: byClass.error || byStudent.error };
}

export function MyExamsPage() {
  const { uid } = useAuth();
  const { exams, loading, error } = useMyExams();
  const attempts = useCollection<Attempt>(C.attempts, () => (uid ? [where('uid', '==', uid)] : null), uid ?? '');
  const results = useCollection<CbtResult>(C.cbtResults, () => (uid ? [where('uid', '==', uid), where('released', '==', true)] : null), uid ?? '');
  const now = Date.now();
  if (loading) return <Spinner />;
  return (
    <>
      <PageHeader title="My examinations" description="Open an examination during its window. Your timer starts when you press Start." />
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {exams.length === 0 ? <Card><EmptyState title="No examinations assigned" description="When your school publishes one for you, it appears here." /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">{exams.map((e) => {
          const mine = attempts.data.filter((a) => a.examId === e.id); const used = mine.length; const live = mine.some((a) => a.status === 'in_progress' && now <= deadlineMs(e, a) + GRACE_MS);
          const open = now >= (toDate(e.startsAt)?.getTime() ?? 0) && now <= (toDate(e.endsAt)?.getTime() ?? 0);
          const res = results.data.filter((r) => r.examId === e.id);
          const canStart = (open && used < e.maxAttempts) || live;
          return (<Card key={e.id}><CardBody className="space-y-3">
            <div><h3 className="font-heading text-lg font-semibold">{e.title}</h3><p className="text-sm text-muted">{e.subjectName}</p></div>
            <p className="text-sm text-muted">{e.durationMinutes} min · {e.questionCount || e.questionIds.length} questions · {used}/{e.maxAttempts} attempts</p>
            <p className="text-xs text-muted">Opens {fmtDate(e.startsAt, true)} · Closes {fmtDate(e.endsAt, true)}</p>
            {res.map((r) => <p key={r.id} className="rounded bg-cream p-2 text-sm">Result: <strong>{r.score}/{r.total} ({r.percentage}%)</strong> <Badge tone={r.passed ? 'ok' : 'danger'}>{r.passed ? 'Pass' : 'Fail'}</Badge>{r.pendingManual > 0 && <span className="text-muted"> · some answers still being marked</span>}</p>)}
            {mine.some((a) => a.status !== 'in_progress') && res.length === 0 && <p className="text-sm text-muted">Submitted. Results will appear when released.</p>}
            {canStart ? <Link to={`/app/cbt/take/${e.id}`}><Button>{live ? 'Resume' : 'Open'}</Button></Link> : <Badge>{!open && now < (toDate(e.startsAt)?.getTime() ?? 0) ? 'Not open yet' : used >= e.maxAttempts ? 'No attempts left' : 'Closed'}</Badge>}
          </CardBody></Card>);
        })}</div>)}
    </>
  );
}

const fmtClock = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

export function TakeExamPage() {
  const { examId = '' } = useParams();
  const { uid, profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const { data: exam, loading } = useDocument<Exam>(C.exams, examId);
  const [attempt, setAttempt] = useState<WithId<Attempt> | null>(null);
  const [paper, setPaper] = useState<Record<string, PaperQuestion>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [left, setLeft] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const offset = useRef(0); // serverNow - clientNow, derived from the server-written startedAt
  const state = useRef({ answers, flagged }); state.current = { answers, flagged };
  const submitting = useRef(false);

  const begin = async () => {
    if (!exam || !uid) return; setBusy(true);
    try {
      const a = await startOrResumeAttempt(exam, { uid, name: profile?.displayName ?? '', studentId: profile?.studentId });
      const p = await listDocs<PaperQuestion>(`${C.exams}/${exam.id}/paper`);
      setPaper(Object.fromEntries(p.map((q) => [q.id, q])));
      setAnswers(a.answers ?? {}); setFlagged(a.flagged ?? []); setAttempt(a);
      const started = toDate(a.startedAt)?.getTime() ?? Date.now();
      void started;
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  const order = useMemo(() => {
    if (!attempt || !exam) return [] as string[];
    const ids = attempt.questionIds.filter((q) => paper[q]);
    return exam.shuffleQuestions ? seededShuffle(ids, `${attempt.id}:q`) : ids;
  }, [attempt, exam, paper]);
  const optionsOf = useCallback((q: string) => { const o = paper[q]?.options ?? []; return exam?.shuffleOptions && attempt ? seededShuffle(o, `${attempt.id}:${q}`) : o; }, [paper, exam, attempt]);

  const doSubmit = useCallback(async (auto: boolean) => {
    if (!attempt || submitting.current) return; submitting.current = true; setBusy(true);
    try { await submitAttempt(attempt.id, attempt.examId, attempt.uid, state.current.answers, state.current.flagged, auto); setDone(true); }
    catch (e) { submitting.current = false; toast.error(`Could not submit: ${errorMessage(e)}. Check your connection and try again.`); }
    finally { setBusy(false); }
  }, [attempt, toast]);

  // countdown + auto-submit
  useEffect(() => {
    if (!attempt || !exam || done) return;
    const end = deadlineMs(exam, attempt);
    const tick = () => { const rem = end - (Date.now() + offset.current); setLeft(rem); if (rem <= 0) void doSubmit(true); };
    tick(); const t = setInterval(tick, 1000); return () => clearInterval(t);
  }, [attempt, exam, done, doSubmit]);

  // autosave (debounced) + best-effort save on hide
  useEffect(() => {
    if (!attempt || done) return;
    setSaveState('saving');
    const t = setTimeout(() => { saveProgress(attempt.id, answers, flagged).then(() => setSaveState('saved')).catch(() => setSaveState('offline')); }, 1200);
    return () => clearTimeout(t);
  }, [answers, flagged, attempt, done]);
  useEffect(() => {
    if (!attempt || done) return;
    const onVis = () => { void logEvent(attempt.id, attempt.examId, attempt.uid, document.hidden ? 'blur' : 'focus'); if (document.hidden) void saveProgress(attempt.id, state.current.answers, state.current.flagged).catch(() => undefined); };
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('beforeunload', warn);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('beforeunload', warn); };
  }, [attempt, done]);

  if (loading) return <Spinner />;
  if (!exam) return <EmptyState title="Examination not available" description="It may be unpublished or not assigned to you." />;

  if (done) return (<Card className="mx-auto max-w-lg"><CardBody className="space-y-3 text-center"><span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ok/10 text-ok"><Check /></span><h2 className="font-heading text-xl font-semibold">Answers submitted</h2><p className="text-sm text-muted">Your answers are recorded. {exam.releasePolicy === 'immediate' ? 'Your result appears in My examinations once marked.' : 'Your result appears when your school releases it.'}</p><Button onClick={() => nav('/app/cbt/my-exams')}>Back to my examinations</Button></CardBody></Card>);

  if (!attempt) return (
    <Card className="mx-auto max-w-2xl"><CardHeader title={exam.title} description={exam.subjectName} /><CardBody className="space-y-4">
      <div className="whitespace-pre-line rounded-md bg-cream p-3 text-sm">{exam.instructions}</div>
      <ul className="list-disc space-y-1 pl-5 text-sm"><li>Duration: <strong>{exam.durationMinutes} minutes</strong>. The timer starts now and cannot be paused.</li><li>{exam.questionCount || exam.questionIds.length} questions · {exam.totalMarks} marks.</li>{exam.negativeMarking.enabled && <li>Wrong answers lose marks.</li>}<li>Answers save automatically. When time ends, your paper is submitted for you.</li></ul>
      <Button size="lg" loading={busy} onClick={() => void begin()}>Start examination</Button></CardBody></Card>);

  const qid = order[idx]; const q = qid ? paper[qid] : undefined;
  const answered = order.filter((id) => (answers[id] ?? '').trim()).length;
  const warnLow = left < 5 * 60_000;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="sticky top-14 z-10 -mx-4 mb-4 flex items-center justify-between gap-3 border-b border-line bg-white/95 px-4 py-2 backdrop-blur md:top-0">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{exam.title}</p><p className="text-xs text-muted">{answered}/{order.length} answered · {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : <span className="text-danger">Offline — retrying</span>}</p></div>
        <div role="timer" aria-live="off" className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-lg font-semibold', warnLow ? 'bg-danger/10 text-danger' : 'bg-forest/10 text-forest')}><Clock className="h-4 w-4" />{fmtClock(left)}</div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <Card><CardBody className="space-y-4">
          {q && qid ? (<>
            <div className="flex items-center justify-between"><span className="text-sm text-muted">Question {idx + 1} of {order.length} · {q.marks} mark{q.marks === 1 ? '' : 's'}</span>
              <Button size="sm" variant={flagged.includes(qid) ? 'gold' : 'outline'} onClick={() => setFlagged((f) => (f.includes(qid) ? f.filter((x) => x !== qid) : [...f, qid]))}><Flag className="h-4 w-4" />{flagged.includes(qid) ? 'Marked' : 'Mark for review'}</Button></div>
            <p className="whitespace-pre-line text-base font-medium">{q.prompt}</p>
            {q.imageUrl && <img src={q.imageUrl} alt="Question diagram" className="max-h-64 rounded-md border border-line" />}
            {q.type === 'short' ? (
              <textarea aria-label="Your answer" rows={4} maxLength={2000} className="w-full rounded-md border border-line p-3 text-base focus:outline-none focus:ring-2 focus:ring-forest" value={answers[qid] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [qid]: e.target.value }))} />
            ) : (
              <div role="radiogroup" className="space-y-2">{(q.type === 'tf' ? [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }] : optionsOf(qid)).map((o) => (
                <label key={o.id} className={cn('flex min-h-12 cursor-pointer items-center gap-3 rounded-md border p-3', answers[qid] === o.id ? 'border-forest bg-forest/5' : 'border-line hover:bg-cream')}>
                  <input type="radio" name={qid} className="h-4 w-4 accent-forest" checked={answers[qid] === o.id} onChange={() => setAnswers((a) => ({ ...a, [qid]: o.id }))} /><span>{o.text}</span></label>))}
                {answers[qid] && <button type="button" className="text-xs text-muted underline" onClick={() => setAnswers((a) => { const n = { ...a }; delete n[qid]; return n; })}>Clear answer</button>}</div>)}
            <div className="flex justify-between pt-2"><Button variant="outline" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Previous</Button>{idx < order.length - 1 ? <Button onClick={() => setIdx(idx + 1)}>Next</Button> : <Button variant="gold" onClick={() => setConfirm(true)}>Finish</Button>}</div>
          </>) : <EmptyState title="No questions" />}
        </CardBody></Card>
        <Card className="h-fit"><CardBody><p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Questions</p>
          <div className="grid grid-cols-6 gap-1.5 lg:grid-cols-5">{order.map((id, i) => <button key={id} type="button" aria-label={`Go to question ${i + 1}`} onClick={() => setIdx(i)} className={cn('relative grid h-9 place-items-center rounded text-sm', i === idx ? 'ring-2 ring-forest' : '', (answers[id] ?? '').trim() ? 'bg-forest text-white' : 'bg-cream text-ink', flagged.includes(id) && 'outline outline-2 outline-gold')}>{i + 1}</button>)}</div>
          <p className="mt-3 text-xs text-muted"><span className="text-forest">■</span> answered · gold outline = marked</p>
          <Button className="mt-3 w-full" variant="gold" onClick={() => setConfirm(true)}>Submit</Button></CardBody></Card>
      </div>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} title="Submit your answers?" message={`${answered} of ${order.length} answered${flagged.length ? `, ${flagged.length} marked for review` : ''}. You cannot change them after submitting.`} confirmLabel="Submit now" loading={busy} onConfirm={() => { setConfirm(false); void doSubmit(false); }} />
    </div>
  );
}
