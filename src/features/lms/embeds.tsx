import { useState } from 'react';
import { ClipboardList, FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Spinner, StatusBadge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { fmtDate, toDate } from '@/lib/utils';
import { QuizTake, SubmitAssignmentDialog } from './work';
import type { Assignment_ } from './types';

type Row = Record<string, unknown> & { id: string };
interface Attempt { score?: number; total?: number; percentage?: number; passed?: boolean; submittedAt?: unknown }

/** A quiz placed inside a course module. The learner takes it without leaving the course; the last result stays on the page. */
export function QuizEmbed({ quizId }: { quizId: string }) {
  const { uid, role } = useAuth();
  const quiz = useDocument<Row>(C.quizzes, quizId);
  const attempt = useDocument<Attempt>(C.quizAttempts, uid ? `${quizId}_${uid}` : null);
  const [open, setOpen] = useState(false);
  if (quiz.loading || attempt.loading) return <Spinner />;
  if (!quiz.data) return <p className="text-sm text-muted">This quiz is not available. It may have been removed, or you may not be enrolled.</p>;
  const n = Array.isArray(quiz.data.questions) ? quiz.data.questions.length : 0;
  const a = attempt.data; const student = role === 'student';
  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      <p className="flex items-center gap-2 font-medium"><FileQuestion className="h-5 w-5 text-gold-500" />{String(quiz.data.title)}</p>
      <p className="text-sm text-muted">{n} question{n === 1 ? '' : 's'} · pass mark {String(quiz.data.passMark ?? 50)}%</p>
      {a?.score != null && <p role="status" className="text-sm"><Badge tone={a.passed ? 'ok' : 'warn'}>{a.passed ? 'Passed' : 'Not passed yet'}</Badge> Last score <strong>{a.score}</strong> / {a.total}{a.submittedAt ? ` · ${fmtDate(a.submittedAt, true)}` : ''}</p>}
      {student ? <Button onClick={() => setOpen(true)}>{a ? 'Retake quiz' : 'Start quiz'}</Button> : <p className="text-xs text-muted">Learners take this quiz here. Staff can open it from the Quizzes page.</p>}
      {student && !a && <p className="text-xs text-muted">This lesson is marked complete automatically when you submit the quiz.</p>}
      {open && <QuizTake quiz={quiz.data} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** An assignment placed inside a course module: instructions, deadline, status, grade, and the submit form. */
export function AssignmentEmbed({ assignmentId }: { assignmentId: string }) {
  const { uid, role } = useAuth();
  const asg = useDocument<Assignment_>(C.assignments, assignmentId);
  const sub = useDocument<Row>(C.submissions, uid ? `${assignmentId}_${uid}` : null);
  const [open, setOpen] = useState(false);
  if (asg.loading || sub.loading) return <Spinner />;
  if (!asg.data) return <p className="text-sm text-muted">This assignment is not available. It may have been removed, or it is not shared with you.</p>;
  const a = asg.data; const s = sub.data; const student = role === 'student';
  const due = toDate(a.dueAt); const late = !!due && due < new Date(); const locked = late && a.allowLate === false;
  return (
    <div className="space-y-3 rounded-md border border-line p-4">
      <p className="flex items-center gap-2 font-medium"><ClipboardList className="h-5 w-5 text-gold-500" />{a.title}</p>
      <p className="whitespace-pre-wrap text-sm">{a.instructions}</p>
      <p className="text-xs text-muted">Due {fmtDate(a.dueAt, true)} · {a.maxScore} marks {late && !s ? <Badge tone="danger">{locked ? 'closed' : 'overdue'}</Badge> : null}</p>
      {s && <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge status={String(s.status)} />{s.status === 'graded' && <span><strong>{String(s.score)}</strong> / {a.maxScore}{s.feedback ? ` — ${String(s.feedback)}` : ''}</span>}</p>}
      {student && (!s || s.status !== 'graded') && !locked && <Button onClick={() => setOpen(true)}>{s ? 'Resubmit' : 'Submit your work'}</Button>}
      {student && !s && <p className="text-xs text-muted">This lesson is marked complete automatically when you submit.</p>}
      {!student && <p className="text-xs text-muted">Learners submit here. Staff grade submissions on the Assignments page.</p>}
      {open && <SubmitAssignmentDialog key={a.id} a={a} existing={s ?? undefined} onClose={() => setOpen(false)} />}
    </div>
  );
}
