import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import { Card, StatCard } from '@/components/ui/card';
import { Badge, EmptyState, Spinner } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { fmtDate, toDate } from '@/lib/utils';
import { homeworkStatus, summariseHomework, type HwStatus } from '@/lib/homework';

type A = { title: string; kind?: string; dueAt: unknown; maxScore: number; studentUids?: string[] };
type S = { assignmentId: string; uid: string; status: string; score?: number; feedback?: string; submittedAt?: unknown };

const LABEL: Record<HwStatus, { text: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  open: { text: 'Open', tone: 'info' }, submitted: { text: 'Handed in', tone: 'ok' }, submitted_late: { text: 'Handed in late', tone: 'warn' }, graded: { text: 'Marked', tone: 'ok' }, missing: { text: 'Missing', tone: 'danger' },
};

/** Parent/staff view of one learner's homework. Queries carry the filter the security rules need. */
export function ChildHomework({ studentUid, viewer }: { studentUid: string; viewer: 'parent' | 'student' | 'staff' }) {
  const { uid } = useAuth();
  const key = `${viewer}${uid}${studentUid}`;
  const asg = useCollection<A>(C.assignments, () => (!studentUid ? null : viewer === 'parent' ? [where('parentViewers', 'array-contains', uid ?? '')] : [where('studentUids', 'array-contains', studentUid)]), key);
  const subs = useCollection<S>(C.submissions, () => (!studentUid ? null : viewer === 'parent' ? [where('parentUids', 'array-contains', uid ?? '')] : [where('uid', '==', studentUid)]), key);
  const now = Date.now();
  const rows = useMemo(() => asg.data.filter((a) => (a.studentUids ?? []).includes(studentUid)).map((a) => {
    const s = subs.data.find((x) => x.assignmentId === a.id && x.uid === studentUid);
    const dueMs = toDate(a.dueAt)?.getTime() ?? 0;
    const hs = s ? { assignmentId: a.id, submittedMs: toDate(s.submittedAt)?.getTime() ?? null, status: s.status, score: s.score } : undefined;
    const h = { id: a.id, dueMs, maxScore: a.maxScore };
    return { a, s, h, hs, status: homeworkStatus(h, hs, now) };
  }).sort((x, y) => y.h.dueMs - x.h.dueMs), [asg.data, subs.data, studentUid, now]);
  const sum = summariseHomework(rows.map((r) => ({ a: r.h, s: r.hs })), now);
  if (!studentUid) return <Card><EmptyState title="No homework yet" description="This learner has no portal login linked yet." /></Card>;
  if (asg.loading || subs.loading) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4"><StatCard label="Handed in" value={`${sum.submitted}/${sum.due}`} tone="ok" /><StatCard label="On time" value={sum.onTime} /><StatCard label="Missing" value={sum.missing} tone={sum.missing ? 'danger' : 'ok'} /><StatCard label="Average mark" value={sum.avgPct === null ? '-' : `${sum.avgPct}%`} /></div>
      <Card>{rows.length === 0 ? <EmptyState title="No homework" description="Homework set for this learner's class or courses appears here." /> : (
        <ul className="divide-y divide-line">{rows.map(({ a, s, status }) => (
          <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 p-4"><div className="min-w-0"><p className="font-medium">{a.title}</p><p className="text-xs text-muted">{a.kind ?? 'homework'} · due {fmtDate(a.dueAt, true)}</p>
            {s?.status === 'graded' && <p className="mt-1 text-sm"><strong>{String(s.score)}</strong> / {a.maxScore}{s.feedback ? ` - ${s.feedback}` : ''}</p>}</div>
            <Badge tone={LABEL[status].tone}>{LABEL[status].text}</Badge></li>))}</ul>)}</Card>
    </div>
  );
}
