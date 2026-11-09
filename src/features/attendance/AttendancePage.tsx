import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, ErrorState, Spinner, TableWrap, Td, Th, Tabs } from '@/components/ui/data';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useSessions } from '@/features/schedule/useSessions';
import { CategoryBadge } from '@/features/schedule/AttendancePanel';
import { useGrace, useStudentNames } from './useAttendance';
import { useCollection } from '@/hooks/useFirestore';
import { subscribeCollection, replaceDoc } from '@/services/db';
import { audit } from '@/services/audit';
import { C } from '@/config/collections';
import { CATEGORY_LABEL } from '@/lib/attendance';
import { buildRows, groupRows, monthsBetween, type GroupBy, type RRecord } from '@/lib/attendanceReport';
import { toCsv } from '@/lib/csv';
import { DEFAULT_TZ, utcToZoned } from '@/lib/schedule/tz';
import { downloadText, errorMessage, fmtDate, toDate } from '@/lib/utils';
import type { AcademicSession, SessionAttendance, Student, WithId } from '@/types/models';

const today = () => utcToZoned(new Date(), DEFAULT_TZ).date;
const daysAgo = (n: number) => utcToZoned(new Date(Date.now() - n * 86_400_000), DEFAULT_TZ).date;
const GROUPS: { id: GroupBy; label: string }[] = [{ id: 'student', label: 'By student' }, { id: 'class', label: 'By class' }, { id: 'course', label: 'By course' }, { id: 'teacher', label: 'By teacher' }, { id: 'session', label: 'By session' }];

export function AttendancePage() {
  const { uid, role } = useAuth();
  const toast = useToast();
  const grace = useGrace();
  const [from, setFrom] = useState(daysAgo(30)); const [to, setTo] = useState(today());
  const [f, setF] = useState({ classId: '', courseId: '', teacherUid: '', studentUid: '', academic: '' });
  const [group, setGroup] = useState<GroupBy>('student');
  const [recsByMonth, setRecsByMonth] = useState<Record<string, WithId<SessionAttendance>[]>>({});
  const [recErr, setRecErr] = useState<string | null>(null);

  const wide = role === 'super_admin' || role === 'admin' || role === 'principal' || role === 'director';
  const isTeacher = role === 'teacher'; const isStudent = role === 'student'; const isParent = role === 'parent';
  const staff = wide || isTeacher;

  const months = useMemo(() => monthsBetween(from, to), [from, to]);
  const { sessions, loading, error } = useSessions(months, uid, wide || isTeacher ? wide : false);
  const { names } = useStudentNames(staff);
  const kids = useCollection<Student>(C.students, () => (isParent && uid ? [where('parentUids', 'array-contains', uid)] : null), isParent ? uid ?? '' : '');
  const academic = useCollection<AcademicSession>(C.academicSessions, () => [], 'all');

  // Attendance records for the same month buckets, with the constraint the security rules can prove for this role.
  useEffect(() => {
    if (!uid) return;
    setRecErr(null);
    const extra = wide ? [] : isTeacher ? [where('teacherUid', '==', uid)] : isStudent ? [where('studentUid', '==', uid)] : isParent ? [where('parentUids', 'array-contains', uid)] : null;
    if (extra === null) return;
    const keys = [...new Set(months.map((m) => m.slice(0, 7)))];
    const un = keys.map((k) => subscribeCollection<SessionAttendance>(C.sessionAttendance, [where('monthKey', '==', k), ...extra], (rows) => setRecsByMonth((m) => ({ ...m, [k]: rows })), (e) => setRecErr(errorMessage(e))));
    return () => un.forEach((u) => u());
  }, [months.join('|'), uid, role]); // eslint-disable-line react-hooks/exhaustive-deps

  const rsessions = useMemo(() => sessions
    // teachers see only their own sessions here, so reports match the records they can read
    .filter((s) => (isTeacher && !wide ? s.teacherUid === uid : true))
    .map((s) => ({ id: s.id, title: s.title, startMs: toDate(s.startAt)!.getTime(), endMs: toDate(s.endAt)!.getTime(), localDate: s.localDate, status: s.status, teacherUid: s.teacherUid, teacherName: s.teacherName, classId: s.classId, className: s.className, courseId: s.courseId, courseName: s.courseName, studentUids: s.studentUids })), [sessions, isTeacher, wide, uid]);
  const records: RRecord[] = useMemo(() => Object.values(recsByMonth).flat().map((r) => ({ sessionId: r.sessionId, studentUid: r.studentUid, studentName: r.studentName, status: r.status, timing: r.timing, checkInMs: toDate(r.checkInAt)?.getTime() ?? null, verifiedByName: r.verifiedByName, note: r.note })), [recsByMonth]);

  const allNames = useMemo(() => { const m = { ...names }; for (const k of kids.data) if (k.studentUid) m[k.studentUid] = `${k.firstName} ${k.lastName}`.trim(); return m; }, [names, kids.data]);
  const only = isStudent ? [uid ?? ''] : isParent ? kids.data.map((k) => k.studentUid).filter(Boolean) : undefined;
  const rows = useMemo(() => buildRows(rsessions, records, grace, Date.now(), { from, to, classId: f.classId, courseId: f.courseId, teacherUid: f.teacherUid, studentUid: f.studentUid }, allNames, only), [rsessions, records, grace, from, to, f, allNames, only?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupRows(rows, group), [rows, group]);

  const opts = (get: (s: typeof rsessions[number]) => [string | undefined, string | undefined]) => { const m = new Map<string, string>(); for (const s of rsessions) { const [k, l] = get(s); if (k) m.set(k, l || k); } return [...m]; };
  const classOpts = opts((s) => [s.classId, s.className]); const courseOpts = opts((s) => [s.courseId, s.courseName]); const teacherOpts = opts((s) => [s.teacherUid, s.teacherName]);
  const studentOpts = useMemo(() => { const m = new Map<string, string>(); for (const r of rows) m.set(r.studentUid, r.studentName); return [...m].sort((a, b) => a[1].localeCompare(b[1])); }, [rows]);

  const total = rows.length;
  const overall = useMemo(() => { const g = groupRows(rows.map((r) => ({ ...r, session: { ...r.session, classId: 'x', className: 'All' } })), 'class')[0]; return g?.counts ?? null; }, [rows]);

  const exportCsv = () => {
    const head = ['Date', 'Session', 'Class', 'Course', 'Teacher', 'Learner', 'Status', 'Check-in (UTC)', 'Verified by', 'Note'];
    const body = rows.map((r) => [r.session.localDate, r.session.title, r.session.className ?? '', r.session.courseName ?? '', r.session.teacherName, r.studentName, CATEGORY_LABEL[r.category], r.record?.checkInMs ? new Date(r.record.checkInMs).toISOString() : '', r.record?.verifiedByName ?? '', r.record?.note ?? '']);
    downloadText(`attendance_${from}_to_${to}.csv`, toCsv([head, ...body]));
    void audit('attendance.export', `${from}..${to}`, `${rows.length} rows`);
  };
  const pickAcademic = (id: string) => { setF({ ...f, academic: id }); const a = academic.data.find((x) => x.id === id); if (a) { setFrom(a.startDate); setTo(a.endDate < today() ? a.endDate : today()); } };

  return (
    <div>
      <PageHeader title="Class attendance" description="Live-class attendance from the timetable. Self check-ins stay pending until a teacher confirms them." actions={<div className="flex gap-2 print:hidden"><Button variant="outline" onClick={exportCsv} disabled={!rows.length}><Download className="h-4 w-4" /> CSV</Button><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button></div>} />

      <Card className="mb-4 print:hidden"><CardBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="From">{(a) => <Input {...a} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(a) => <Input {...a} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label="Academic session">{(a) => <Select {...a} value={f.academic} onChange={(e) => pickAcademic(e.target.value)}><option value="">Custom dates</option>{academic.data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>}</Field>
          {!isStudent && <Field label={isParent ? 'Child' : 'Learner'}>{(a) => <Select {...a} value={f.studentUid} onChange={(e) => setF({ ...f, studentUid: e.target.value })}><option value="">All</option>{studentOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>}
          <Field label="Class">{(a) => <Select {...a} value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}><option value="">All</option>{classOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          <Field label="Course">{(a) => <Select {...a} value={f.courseId} onChange={(e) => setF({ ...f, courseId: e.target.value })}><option value="">All</option>{courseOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>
          {wide && <Field label="Teacher">{(a) => <Select {...a} value={f.teacherUid} onChange={(e) => setF({ ...f, teacherUid: e.target.value })}><option value="">All</option>{teacherOpts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>}</Field>}
        </div>
        {months.length >= 12 && <p className="mt-2 text-xs text-muted">Reports cover up to 12 months at a time.</p>}
      </CardBody></Card>

      {(error || recErr) && <ErrorState message={error || recErr || ''} />}
      {loading ? <Spinner /> : total === 0 ? <EmptyState title="No sessions in this range" description="Only past, non-cancelled classes are counted. Learners must be invited through the timetable." /> : (
        <>
          {overall && (
            <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
              {([['Attendance', overall.pct == null ? '-' : `${overall.pct}%`], ['Early', overall.early], ['On time', overall.on_time], ['Late', overall.late], ['Absent', overall.absent], ['Excused', overall.excused], ['Pending', overall.pending]] as const).map(([k, v]) => <Card key={k}><CardBody className="py-3"><p className="text-xs text-muted">{k}</p><p className="font-heading text-xl">{v}</p></CardBody></Card>)}
            </div>)}
          <div className="mb-3 print:hidden"><Tabs tabs={GROUPS} value={group} onChange={setGroup} /></div>
          <Card><CardHeader title={GROUPS.find((g) => g.id === group)!.label} description={`${fmtDate(from)} to ${fmtDate(to)} · ${total} learner-sessions · on time up to ${grace} min after the start`} />
            <TableWrap><thead><tr><Th>{group === 'session' ? 'Session' : group[0]!.toUpperCase() + group.slice(1)}</Th><Th>Expected</Th><Th>Early</Th><Th>On time</Th><Th>Late</Th><Th>Left early</Th><Th>Absent</Th><Th>Excused</Th><Th>Pending</Th><Th>No record</Th><Th>%</Th></tr></thead><tbody>
              {groups.map((g) => <tr key={g.key}><Td>{g.label}</Td><Td>{g.counts.expected}</Td><Td>{g.counts.early}</Td><Td>{g.counts.on_time}</Td><Td>{g.counts.late}</Td><Td>{g.counts.left_early}</Td><Td>{g.counts.absent}</Td><Td>{g.counts.excused}</Td><Td>{g.counts.pending}</Td><Td>{g.counts.none}</Td><Td className="font-medium">{g.counts.pct == null ? '-' : `${g.counts.pct}%`}</Td></tr>)}</tbody></TableWrap>
            <p className="px-5 py-3 text-xs text-muted">% = confirmed attendances ÷ (expected − excused). Pending check-ins and sessions with no record are not counted as attended. Teachers can finalise a class to turn "no record" into Absent.</p>
          </Card>

          <Card className="mt-4"><CardHeader title="Detail" description={rows.length > 200 ? 'Showing the latest 200 rows. Export CSV for all.' : undefined} />
            <TableWrap><thead><tr><Th>Date</Th><Th>Session</Th><Th>Learner</Th><Th>Status</Th><Th>Verified by</Th></tr></thead><tbody>
              {rows.slice(0, 200).map((r) => <tr key={`${r.sessionId}_${r.studentUid}`}><Td>{r.session.localDate}</Td><Td>{r.session.title}{r.session.className ? ` · ${r.session.className}` : ''}</Td><Td>{r.studentName}</Td><Td><CategoryBadge c={r.category} /></Td><Td className="text-xs text-muted">{r.record?.verifiedByName ?? ''}</Td></tr>)}</tbody></TableWrap>
          </Card>
        </>)}

      {wide && role !== 'director' && <GraceCard grace={grace} onSaved={() => toast.success('Saved')} onError={(m) => toast.error(m)} />}
    </div>);
}

function GraceCard({ grace, onSaved, onError }: { grace: number; onSaved: () => void; onError: (m: string) => void }) {
  const [v, setV] = useState(String(grace)); const [busy, setBusy] = useState(false);
  useEffect(() => setV(String(grace)), [grace]);
  const save = async () => {
    const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 60) { onError('Enter 0 to 60 minutes.'); return; }
    setBusy(true); try { await replaceDoc(C.settings, 'attendance', { onTimeGraceMinutes: Math.round(n) }); void audit('attendance.grace', 'settings/attendance', `${n} min`); onSaved(); } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-6 print:hidden"><CardHeader title="On-time grace period" description="A learner is early before the scheduled start, on time up to this many minutes after it, and late after that." />
      <CardBody><div className="flex max-w-xs items-end gap-2"><Field label="Minutes">{(a) => <Input {...a} type="number" min={0} max={60} value={v} onChange={(e) => setV(e.target.value)} />}</Field><Button loading={busy} onClick={() => void save()}>Save</Button></div></CardBody></Card>);
}
