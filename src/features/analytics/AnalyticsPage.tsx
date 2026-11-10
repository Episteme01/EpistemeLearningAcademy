import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { EmptyState, Spinner, TableWrap, Td, Th } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { useSessions } from '@/features/schedule/useSessions';
import { useGrace, useStudentNames } from '@/features/attendance/useAttendance';
import { C } from '@/config/collections';
import { subscribeCollection } from '@/services/db';
import { buildRows, groupRows, monthsBetween } from '@/lib/attendanceReport';
import { homeworkByAssignment, homeworkByClass, missingByLearner, needingAttention, ATTENDANCE_FLOOR, MISSING_LIMIT, type AssignmentRow } from '@/lib/analytics';
import { summariseHomework } from '@/lib/homework';
import { toDate } from '@/lib/utils';
import type { SessionAttendance } from '@/types/models';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** School-wide (leaders) or own-classes (teachers) picture of attendance and homework. Everything is read through the same rules as the rest of the app. */
export function AnalyticsPage() {
  const { uid, role } = useAuth();
  const wide = role === 'super_admin' || role === 'admin' || role === 'principal' || role === 'director';
  const grace = useGrace();
  const [to, setTo] = useState(iso(new Date()));
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86_400_000)));
  const months = useMemo(() => monthsBetween(from, to), [from, to]);
  const { sessions, loading: sl } = useSessions(months, uid, wide);
  const { names } = useStudentNames(true);
  const [recs, setRecs] = useState<Record<string, SessionAttendance[]>>({});
  useEffect(() => {
    if (!uid) return;
    const extra = wide ? [] : [where('teacherUid', '==', uid)];
    const keys = [...new Set(months.map((m) => m.slice(0, 7)))];
    const un = keys.map((k) => subscribeCollection<SessionAttendance>(C.sessionAttendance, [where('monthKey', '==', k), ...extra], (rows) => setRecs((m) => ({ ...m, [k]: rows })), () => undefined));
    return () => un.forEach((u) => u());
  }, [months.join('|'), uid, wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const asg = useCollection<{ title: string; classId?: string; className?: string; dueAt: unknown; maxScore: number; studentUids?: string[]; teacherUid: string }>(C.assignments, () => (uid ? (wide ? [] : [where('teacherUid', '==', uid)]) : null), `a${wide}${uid}`);
  const subs = useCollection<{ assignmentId: string; uid: string; status: string; score?: number; submittedAt?: unknown }>(C.submissions, () => (uid ? [] : null), `s${uid}`);
  const classes = useCollection<{ name: string }>(C.classes, () => [], 'cls');

  const now = Date.now();
  const model = useMemo(() => {
    const fromMs = new Date(from + 'T00:00:00').getTime(); const toMs = new Date(to + 'T23:59:59').getTime();
    const rs = sessions.filter((s) => (wide || s.teacherUid === uid)).map((s) => ({ id: s.id, title: s.title, startMs: toDate(s.startAt)!.getTime(), endMs: toDate(s.endAt)!.getTime(), localDate: s.localDate, status: s.status, teacherUid: s.teacherUid, teacherName: s.teacherName, classId: s.classId, className: s.className, courseId: s.courseId, courseName: s.courseName, studentUids: s.studentUids ?? [] }));
    const records = Object.values(recs).flat().map((r) => ({ sessionId: r.sessionId, studentUid: r.studentUid, studentName: r.studentName, status: r.status, timing: r.timing, checkInMs: toDate(r.checkInAt)?.getTime() ?? null }));
    const rows = buildRows(rs, records, grace, now, { from, to }, names);
    const byClass = groupRows(rows, 'class'); const byStudent = groupRows(rows, 'student');
    const classNameById = new Map(classes.data.map((c) => [c.id, c.name]));
    const assignments: AssignmentRow[] = asg.data.filter((a) => { const d = toDate(a.dueAt)?.getTime() ?? 0; return d >= fromMs && d <= toMs + 7 * 86_400_000; }).map((a) => ({ id: a.id, title: a.title, classId: a.classId, className: a.className || (a.classId ? classNameById.get(a.classId) : '') || '', dueMs: toDate(a.dueAt)?.getTime() ?? 0, maxScore: a.maxScore, studentUids: a.studentUids ?? [] }));
    const hs = subs.data.map((s) => ({ assignmentId: s.assignmentId, uid: s.uid, submittedMs: toDate(s.submittedAt)?.getTime() ?? null, status: s.status, score: s.score }));
    const miss = missingByLearner(assignments, hs, now);
    const signals = byStudent.map((g) => ({ uid: g.key, name: g.label, attendancePct: g.counts.pct, attendanceExpected: g.counts.expected, missingHomework: miss[g.key] ?? 0 }));
    for (const [u, n] of Object.entries(miss)) if (!signals.some((s) => s.uid === u)) signals.push({ uid: u, name: names[u] ?? 'Learner', attendancePct: null, attendanceExpected: 0, missingHomework: n });
    const all = summariseHomework(assignments.flatMap((a) => a.studentUids.map((u) => ({ a: { id: a.id, dueMs: a.dueMs, maxScore: a.maxScore }, s: hs.find((s) => s.assignmentId === a.id && s.uid === u) }))), now);
    const totalPct = (() => { const e = byClass.reduce((x, g) => x + g.counts.expected, 0); const p = byClass.reduce((x, g) => x + g.counts.attended, 0); return e ? Math.round((p / e) * 100) : null; })();
    return { byClass, hwClass: homeworkByClass(assignments, hs, now), hwAsg: homeworkByAssignment(assignments, hs, now), attention: needingAttention(signals), all, totalPct };
  }, [sessions, recs, asg.data, subs.data, classes.data, names, grace, from, to, wide, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (sl && asg.loading) return <Spinner />;
  const pctOr = (n: number | null) => (n === null ? '-' : `${n}%`);
  return (
    <>
      <PageHeader title="Analytics" description={wide ? 'Attendance and homework across the school.' : 'Attendance and homework for your own classes.'} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="To">{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Class attendance" value={pctOr(model.totalPct)} tone="ok" />
        <StatCard label="Homework handed in" value={model.all.due ? `${Math.round((model.all.submitted / model.all.due) * 100)}%` : '-'} />
        <StatCard label="On time" value={model.all.submitted ? `${Math.round((model.all.onTime / model.all.submitted) * 100)}%` : '-'} />
        <StatCard label="Average homework mark" value={pctOr(model.all.avgPct)} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Attendance by class" /><CardBody>{model.byClass.length === 0 ? <EmptyState title="No sessions in this period" /> : <div className="h-64"><ResponsiveContainer><BarChart data={model.byClass.map((g) => ({ name: g.label, pct: g.counts.pct ?? 0 }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis domain={[0, 100]} fontSize={11} /><Tooltip formatter={(v: number) => `${v}%`} /><Bar dataKey="pct" fill="#0B3D2E" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</CardBody></Card>
        <Card><CardHeader title="Homework handed in, by class" /><CardBody>{model.hwClass.length === 0 ? <EmptyState title="No homework in this period" /> : <div className="h-64"><ResponsiveContainer><BarChart data={model.hwClass.map((g) => ({ name: g.label, pct: g.summary.due ? Math.round((g.summary.submitted / g.summary.due) * 100) : 0 }))}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" fontSize={11} /><YAxis domain={[0, 100]} fontSize={11} /><Tooltip formatter={(v: number) => `${v}%`} /><Bar dataKey="pct" fill="#C8A45A" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>}</CardBody></Card>
      </div>
      <Card className="mt-5"><CardHeader title="Homework by assignment" />{model.hwAsg.length === 0 ? <EmptyState title="No homework in this period" /> : <TableWrap><thead><tr><Th>Assignment</Th><Th>Learners</Th><Th>Handed in</Th><Th>On time</Th><Th>Missing</Th><Th>Avg mark</Th></tr></thead><tbody>{model.hwAsg.map((g) => <tr key={g.key}><Td>{g.label}</Td><Td>{g.learners}</Td><Td>{g.summary.submitted}/{g.summary.due}</Td><Td>{g.summary.onTime}</Td><Td>{g.summary.missing}</Td><Td>{pctOr(g.summary.avgPct)}</Td></tr>)}</tbody></TableWrap>}</Card>
      <Card className="mt-5"><CardHeader title="Learners who may need support" /><CardBody className="pt-0"><p className="mb-3 text-xs text-muted">Attendance below {ATTENDANCE_FLOOR}% (after at least 3 sessions) or {MISSING_LIMIT}+ missing homework in this period.</p>
        {model.attention.length === 0 ? <EmptyState title="Nobody flagged" description="Everyone is on track for this period." /> : <ul className="divide-y divide-line">{model.attention.map((a) => <li key={a.uid} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className="font-medium">{a.name}</span><span className="text-muted">{a.reasons.join(' · ')}</span></li>)}</ul>}</CardBody></Card>
    </>
  );
}
