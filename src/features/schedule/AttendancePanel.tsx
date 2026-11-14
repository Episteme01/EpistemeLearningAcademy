import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Badge, TableWrap, Td, Th } from '@/components/ui/data';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { useGrace, useStudentNames } from '@/features/attendance/useAttendance';
import { C } from '@/config/collections';
import { CATEGORY_LABEL, categoryOf, detailOf, type Category } from '@/lib/attendance';
import { confirmAll, confirmPending, finalise, selfCheckIn, staffMark } from '@/services/attendance';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';
import type { AttendanceLog, AttStatus, AttTiming, Session, SessionAttendance, WithId } from '@/types/models';

const TONE: Record<Category, 'ok' | 'info' | 'warn' | 'danger' | 'neutral'> = { early: 'ok', on_time: 'ok', late: 'warn', left_early: 'warn', absent: 'danger', excused: 'info', pending: 'warn', none: 'neutral' };
export const CategoryBadge = ({ c }: { c: Category }) => <Badge tone={TONE[c]}>{CATEGORY_LABEL[c]}</Badge>;

const OPEN_BEFORE = 15 * 60_000;

/** Attendance section inside the session dialog: learner check-in, parent view, teacher roll call. */
export function AttendancePanel({ session }: { session: WithId<Session> }) {
  const { uid, role, profile } = useAuth();
  const toast = useToast();
  const grace = useGrace();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<{ uid: string; name: string; status: AttStatus; timing: AttTiming | ''; reason: string } | null>(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const leader = role === 'super_admin' || role === 'admin' || role === 'principal';
  const viewerOnly = role === 'director';
  const manage = leader || (role === 'teacher' && session.teacherUid === uid);
  const isLearner = !!uid && session.studentUids.includes(uid) && !manage;
  const isParent = !!uid && session.parentUids.includes(uid) && !manage;
  const by = { uid: uid ?? '', name: profile?.displayName ?? '', role: role ?? '' };

  const start = toDate(session.startAt)!.getTime(); const end = toDate(session.endAt)!.getTime();
  const recs = useCollection<SessionAttendance>(C.sessionAttendance, () => {
    if (!uid) return null;
    const base = [where('sessionId', '==', session.id)];
    if (manage || viewerOnly) return leader || viewerOnly ? base : [...base, where('teacherUid', '==', uid)];
    if (isLearner) return [...base, where('studentUid', '==', uid)];
    if (isParent) return [...base, where('parentUids', 'array-contains', uid)];
    return null;
  }, `${session.id}|${role}|${uid}`);
  const logs = useCollection<AttendanceLog>(C.attendanceLog, () => (manage || viewerOnly ? [where('sessionId', '==', session.id), ...(leader || viewerOnly ? [] : [where('teacherUid', '==', uid ?? '')])] : null), manage ? `${session.id}${role}` : '');
  const { names } = useStudentNames(manage || viewerOnly);

  const byStudent = useMemo(() => { const m: Record<string, WithId<SessionAttendance>> = {}; for (const r of recs.data) m[r.studentUid] = r; return m; }, [recs.data]);
  const asLike = (r: WithId<SessionAttendance> | undefined) => (r ? { status: r.status, timing: r.timing, checkInMs: toDate(r.checkInAt)?.getTime() ?? null, startMs: start } : null);
  const nameOf = (u: string) => byStudent[u]?.studentName || names[u] || 'Learner';

  if (session.status === 'cancelled') return null;
  if (!manage && !viewerOnly && !isLearner && !isParent) return null;

  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); setEdit(null); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };

  /* -------------------------------------------------------------- learner */
  if (isLearner) {
    const mine = byStudent[uid!];
    const canCheckIn = !mine && session.status === 'scheduled' && now >= start - OPEN_BEFORE && now <= end;
    return (
      <div className="rounded-md border border-line p-3 text-sm">
        <p className="mb-2 flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> My attendance</p>
        {mine ? (
          <div className="space-y-1">
            <p className="flex flex-wrap items-center gap-2"><CategoryBadge c={categoryOf(asLike(mine), grace)} /> <span className="text-muted">{detailOf(asLike(mine), grace)}</span></p>
            {mine.checkInAt != null && <p className="text-xs text-muted">{mine.method === 'link_click' ? 'Recorded automatically when you opened the meeting link' : 'Checked in'} {fmtDate(mine.checkInAt, true)}</p>}
            {mine.status === 'pending_verification' && <p className="text-xs text-muted">Your teacher will confirm this.</p>}
            {mine.note && <p className="text-xs">Note: {mine.note}</p>}
          </div>
        ) : canCheckIn ? (
          <div className="space-y-2">
            <Button loading={busy} onClick={() => void run(() => selfCheckIn(session, { uid: uid!, name: profile?.displayName ?? '' }), 'Checked in. Your teacher will confirm it.')}>I am in class: check me in</Button>
            <p className="text-xs text-muted">{session.online ? 'Opening the meeting from this page marks you present automatically. Use this button only if you joined another way.' : 'Only check in for yourself.'}</p>
          </div>
        ) : (
          <p className="flex items-center gap-1 text-muted"><Clock className="h-4 w-4" /> {now < start - OPEN_BEFORE ? 'Check-in opens 15 minutes before the class.' : session.status === 'completed' || now > end ? 'Check-in is closed. Ask your teacher if you attended.' : 'Not available.'}</p>
        )}
      </div>);
  }

  /* --------------------------------------------------------------- parent */
  if (isParent) {
    return (
      <div className="rounded-md border border-line p-3 text-sm">
        <p className="mb-2 font-medium">Attendance</p>
        {recs.data.length === 0 ? <p className="text-muted">No attendance recorded for this class yet.</p> : (
          <ul className="space-y-1">{recs.data.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><span>{r.studentName}</span><CategoryBadge c={categoryOf(asLike(r), grace)} /><span className="text-xs text-muted">{detailOf(asLike(r), grace)}</span></li>)}</ul>)}
      </div>);
  }

  /* -------------------------------------------------------- roll call (staff) */
  const pending = recs.data.filter((r) => r.status === 'pending_verification');
  const unmarked = session.studentUids.filter((u) => !byStudent[u]).length;
  const started = now >= start;
  const needsReason = !!edit && !(byStudent[edit.uid]?.status === 'pending_verification');

  return (
    <div className="rounded-md border border-line p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Attendance roll call <span className="font-normal text-muted">({session.studentUids.length} invited · on time up to {grace} min after the start)</span></p>
        {manage && started && (
          <div className="flex flex-wrap gap-2">
            {pending.length > 0 && <Button size="sm" variant="outline" loading={busy} onClick={() => void run(() => confirmAll(session, pending, grace, by).then((n) => n), 'Check-ins confirmed')}>Confirm all ({pending.length})</Button>}
            {unmarked > 0 && <Button size="sm" variant="outline" loading={busy} onClick={() => { if (window.confirm(`Mark the ${unmarked} learner(s) with no check-in as Absent?`)) void run(() => finalise(session, names, recs.data, by), 'Attendance finalised'); }}>Finalise: mark {unmarked} absent</Button>}
          </div>)}
      </div>
      {session.studentUids.length === 0 ? <p className="text-muted">No learner logins are invited to this class.</p> : (
        <TableWrap><thead><tr><Th>Learner</Th><Th>Status</Th><Th>Detail</Th>{manage && <Th />}</tr></thead><tbody>
          {session.studentUids.map((u) => {
            const r = byStudent[u]; const cat = categoryOf(asLike(r), grace);
            return (
              <tr key={u}>
                <Td>{nameOf(u)}</Td>
                <Td><CategoryBadge c={cat} /></Td>
                <Td className="text-xs text-muted">{r ? `${detailOf(asLike(r), grace)}${r.verifiedByName ? ` · by ${r.verifiedByName}` : ''}` : started ? 'Not recorded' : ''}{r?.note ? ` · ${r.note}` : ''}</Td>
                {manage && <Td><div className="flex gap-1">
                  {r?.status === 'pending_verification' && started && <Button size="sm" loading={busy} onClick={() => void run(() => confirmPending(session, r, grace, by), 'Confirmed')}>Confirm</Button>}
                  {started && <Button size="sm" variant="outline" onClick={() => setEdit({ uid: u, name: nameOf(u), status: r && r.status !== 'pending_verification' ? r.status : 'present', timing: (r?.timing as AttTiming | '') ?? '', reason: '' })}>{r && r.status !== 'pending_verification' ? 'Correct' : 'Mark'}</Button>}
                </div></Td>}
              </tr>);
          })}</tbody></TableWrap>)}
      {!started && manage && <p className="mt-2 text-xs text-muted">Marking opens when the class starts.</p>}

      {edit && manage && (
        <div className="mt-3 space-y-3 rounded-md border border-forest-200 bg-forest-50/40 p-3">
          <p className="font-medium">{byStudent[edit.uid] && byStudent[edit.uid]!.status !== 'pending_verification' ? 'Correct' : 'Mark'}: {edit.name}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status">{(a) => <Select {...a} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as AttStatus })}><option value="present">Present</option><option value="left_early">Left early</option><option value="absent">Absent</option><option value="excused">Excused</option></Select>}</Field>
            {(edit.status === 'present' || edit.status === 'left_early') && <Field label="Timing">{(a) => <Select {...a} value={edit.timing} onChange={(e) => setEdit({ ...edit, timing: e.target.value as AttTiming | '' })}><option value="">On time (default)</option><option value="early">Early</option><option value="on_time">On time</option><option value="late">Late</option></Select>}</Field>}
          </div>
          <Field label={needsReason ? 'Reason (required, saved in the history)' : 'Note (optional)'}>{(a) => <Textarea {...a} rows={2} value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void run(() => staffMark({ session, studentUid: edit.uid, studentName: edit.name, existing: byStudent[edit.uid] ?? null, status: edit.status, timing: edit.timing || (edit.status === 'present' || edit.status === 'left_early' ? 'on_time' : ''), reason: edit.reason }, by), 'Attendance saved')}>Save</Button>
            <Button size="sm" variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>)}

      {(manage || viewerOnly) && (
        <details className="mt-3 rounded-md border border-line"><summary className="cursor-pointer px-3 py-2 font-medium">Correction history ({logs.data.length})</summary>
          {logs.data.length === 0 ? <p className="px-3 pb-3 text-xs text-muted">No changes yet.</p> : (
            <TableWrap><thead><tr><Th>When</Th><Th>Learner</Th><Th>Change</Th><Th>By</Th><Th>Reason</Th></tr></thead><tbody>
              {[...logs.data].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0)).map((l) => <tr key={l.id}><Td>{fmtDate(l.at, true)}</Td><Td>{nameOf(l.studentUid)}</Td><Td>{l.fromStatus} → {l.toStatus}{l.toTiming ? ` (${l.toTiming})` : ''}</Td><Td>{l.byName}</Td><Td>{l.reason || '—'}</Td></tr>)}</tbody></TableWrap>)}
        </details>)}
    </div>);
}
