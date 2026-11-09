import { useEffect, useState } from 'react';
import { where } from 'firebase/firestore';
import { Copy, ExternalLink, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Badge, StatusBadge, TableWrap, Td, Th } from '@/components/ui/data';
import { Dialog, useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { ROLE_LABELS } from '@/config/permissions';
import { cancelSessions, logAccess, markCompleted, readLink, rescheduleSession, type Scope } from '@/services/schedule';
import { format12, utcToZoned } from '@/lib/schedule/tz';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';
import { AttendancePanel } from './AttendancePanel';
import type { Session, SessionAccessLog, SessionLink, WithId } from '@/types/models';

const JOIN_BEFORE = 15 * 60_000;
const JOIN_AFTER = 30 * 60_000;

export function SessionDialog({ session, tz, onClose, onEdit }: { session: WithId<Session> | null; tz: string; onClose: () => void; onEdit: (s: WithId<Session>) => void }) {
  const { uid, role, profile } = useAuth();
  const toast = useToast();
  const [link, setLink] = useState<SessionLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'view' | 'reschedule' | 'cancel'>('view');
  const [rs, setRs] = useState({ date: '', start: '', end: '', reason: '' });
  const [cx, setCx] = useState<{ scope: Scope; reason: string }>({ scope: 'one', reason: '' });
  const [notify, setNotify] = useState(true);
  const [now, setNow] = useState(Date.now());

  const leader = role === 'super_admin' || role === 'admin' || role === 'principal';
  const canManage = !!session && (leader || (role === 'teacher' && session.teacherUid === uid));
  const by = { uid: uid ?? '', name: profile?.displayName ?? '' };

  useEffect(() => { setLink(null); setMode('view'); setCx({ scope: 'one', reason: '' }); if (session) { const z0 = utcToZoned(toDate(session.startAt)!, session.timezone); const z1 = utcToZoned(toDate(session.endAt)!, session.timezone); setRs({ date: z0.date, start: z0.time, end: z1.time, reason: '' }); } }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const access = useCollection<SessionAccessLog>(C.sessionAccess, () => (session && canManage ? [where('sessionId', '==', session.id), ...(leader ? [] : [where('teacherUid', '==', uid ?? '')])] : null), session && canManage ? `${session.id}${role}` : '');

  if (!session) return null;
  const start = toDate(session.startAt)!.getTime(); const end = toDate(session.endAt)!.getTime();
  const zs = utcToZoned(new Date(start), tz); const ze = utcToZoned(new Date(end), tz);
  const inWindow = now >= start - JOIN_BEFORE && now <= end + JOIN_AFTER;
  const audienceCanJoin = session.status === 'scheduled' && inWindow;
  const isAudience = !!uid && session.viewers.includes(uid);
  const showJoin = session.online && (canManage || isAudience);

  const reveal = async () => {
    setBusy(true);
    try { const l = await readLink(session.id); if (!l) throw new Error('No meeting link was saved for this class.'); setLink(l); void logAccess(session, { uid: uid ?? '', name: by.name, role: role ?? '' }, 'link_view'); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const open = () => { if (!link) return; void logAccess(session, { uid: uid ?? '', name: by.name, role: role ?? '' }, 'link_click'); window.open(link.meetingUrl, '_blank', 'noopener,noreferrer'); };
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.success(ok); setMode('view'); onClose(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };

  return (
    <Dialog open onClose={onClose} title={session.title} description={`${fmtDate(session.startAt)} · ${format12(zs.time)} – ${format12(ze.time)}`} size="lg"
      footer={mode === 'view' ? <Button variant="outline" onClick={onClose}>Close</Button> : <>
        <Button variant="outline" onClick={() => setMode('view')}>Back</Button>
        {mode === 'reschedule' && <Button loading={busy} onClick={() => void run(() => rescheduleSession(session, rs.date, rs.start, rs.end, rs.reason, by, notify), 'Class rescheduled')}>Reschedule</Button>}
        {mode === 'cancel' && <Button variant="danger" loading={busy} onClick={() => void run(() => cancelSessions(session, cx.scope, cx.reason, by, leader, notify), 'Cancelled')}>Cancel class</Button>}</>}>
      {mode === 'view' && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><StatusBadge status={session.status} />{session.online && <Badge tone="info">Online</Badge>}{session.rescheduledFrom != null && <Badge tone="warn">Rescheduled from {fmtDate(session.rescheduledFrom, true)}</Badge>}</div>
          {session.status === 'cancelled' && session.cancelReason && <p className="rounded bg-danger/10 p-2 text-danger">Cancelled: {session.cancelReason}</p>}
          <dl className="grid gap-3 sm:grid-cols-2">
            {[['Course', session.courseName], ['Subject', session.subjectName], ['Class', session.className], ['Teacher', session.teacherName], ['Location', session.location]].map(([k, v]) => v ? <div key={k}><dt className="text-xs text-muted">{k}</dt><dd>{v}</dd></div> : null)}
            {canManage && <div><dt className="text-xs text-muted">Invited</dt><dd>{session.studentUids.length} learner login(s), {session.parentUids.length} parent(s)</dd></div>}
          </dl>
          {session.description && <p className="whitespace-pre-line">{session.description}</p>}

          {showJoin && session.status === 'scheduled' && (
            <div className="rounded-md border border-line p-3">
              <p className="mb-2 flex items-center gap-2 font-medium"><Video className="h-4 w-4" /> Join online</p>
              {!link ? (
                <>
                  <Button onClick={() => void reveal()} loading={busy} disabled={!canManage && !audienceCanJoin}>Show meeting link</Button>
                  {!canManage && !audienceCanJoin && <p className="mt-2 text-xs text-muted">{now < start - JOIN_BEFORE ? `The link unlocks at ${format12(utcToZoned(new Date(start - JOIN_BEFORE), tz).time)}, 15 minutes before the class.` : 'This class has ended.'}</p>}
                </>
              ) : (
                <div className="space-y-2">
                  <Button onClick={open}><ExternalLink className="h-4 w-4" /> Open meeting</Button>
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">{link.meetingId && <div><dt className="text-xs text-muted">Meeting ID</dt><dd className="font-mono">{link.meetingId}</dd></div>}{link.passcode && <div><dt className="text-xs text-muted">Passcode</dt><dd className="font-mono">{link.passcode}</dd></div>}</dl>
                  <button type="button" className="inline-flex items-center gap-1 text-xs text-forest-600 underline" onClick={() => void navigator.clipboard?.writeText(link.meetingUrl).then(() => toast.success('Link copied'))}><Copy className="h-3 w-3" /> Copy link</button>
                </div>)}
              <p className="mt-2 text-xs text-muted">Opening the link is recorded, but it is not proof of attendance.</p>
            </div>)}

          <AttendancePanel session={session} />

          {canManage && (
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {session.status !== 'completed' && <Button variant="outline" size="sm" onClick={() => { onEdit(session); }}>Edit</Button>}
              {session.status !== 'completed' && <Button variant="outline" size="sm" onClick={() => setMode('reschedule')}>Reschedule</Button>}
              {session.status === 'scheduled' && <Button variant="outline" size="sm" onClick={() => setMode('cancel')}>Cancel…</Button>}
              {session.status === 'scheduled' && now > start && <Button variant="outline" size="sm" loading={busy} onClick={() => void run(() => markCompleted(session, by), 'Marked completed')}>Mark completed</Button>}
            </div>)}

          {canManage && (
            <details className="rounded-md border border-line"><summary className="cursor-pointer px-3 py-2 text-sm font-medium">Link access history ({access.data.length})</summary>
              {access.data.length === 0 ? <p className="px-3 pb-3 text-xs text-muted">No one has opened the link yet.</p> : (
                <TableWrap><thead><tr><Th>When</Th><Th>Person</Th><Th>Role</Th><Th>Action</Th></tr></thead><tbody>
                  {[...access.data].sort((a, b) => (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0)).map((a) => <tr key={a.id}><Td>{fmtDate(a.at, true)}</Td><Td>{a.name}</Td><Td>{ROLE_LABELS[a.role as keyof typeof ROLE_LABELS] ?? a.role}</Td><Td>{a.action === 'link_click' ? 'Clicked link' : 'Viewed link'}</Td></tr>)}</tbody></TableWrap>)}
            </details>)}
        </div>)}

      {mode === 'reschedule' && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3"><Field label="New date" required>{(a) => <Input {...a} type="date" value={rs.date} onChange={(e) => setRs({ ...rs, date: e.target.value })} />}</Field><Field label="Starts">{(a) => <Input {...a} type="time" value={rs.start} onChange={(e) => setRs({ ...rs, start: e.target.value })} />}</Field><Field label="Ends">{(a) => <Input {...a} type="time" value={rs.end} onChange={(e) => setRs({ ...rs, end: e.target.value })} />}</Field></div>
          <Field label="Reason (shown to attendees)">{(a) => <Textarea {...a} value={rs.reason} onChange={(e) => setRs({ ...rs, reason: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-700" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify attendees</label>
          <p className="text-xs text-muted">Only this session moves. The original time is kept in its history.</p>
        </div>)}

      {mode === 'cancel' && (
        <div className="space-y-4">
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Cancel</legend>
            {([['one', 'This session only'], ['future', 'This and all later sessions'], ['all', 'The whole series (all upcoming sessions)']] as const).map(([v, l]) => <label key={v} className="flex items-center gap-2 py-1 text-sm"><input type="radio" name="cx" className="accent-forest-700" checked={cx.scope === v} onChange={() => setCx({ ...cx, scope: v })} />{l}</label>)}</fieldset>
          <Field label="Reason" required>{(a) => <Textarea {...a} value={cx.reason} onChange={(e) => setCx({ ...cx, reason: e.target.value })} />}</Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-forest-700" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify attendees</label>
          <p className="text-xs text-muted">Cancelled sessions stay in the history; nothing is deleted.</p>
        </div>)}
    </Dialog>
  );
}
