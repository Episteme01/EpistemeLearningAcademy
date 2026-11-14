import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { rolesOf } from '@/config/permissions';
import { getById, listDocs } from '@/services/db';
import { checkSchedule, createSeries, editSessions, type EditChanges, type Scope, type SeriesInput } from '@/services/schedule';
import { MAX_OCCURRENCES, defaultRecurrence, type Recurrence } from '@/lib/schedule/recurrence';
import { DEFAULT_TZ, format12, utcToZoned } from '@/lib/schedule/tz';
import { errorMessage, toDate } from '@/lib/utils';
import { hasErrors, previewIssues, scopeTargets, type Issue } from '@/lib/schedule/validate';
import { useLiveIssues } from './useLiveConflicts';
import { where } from 'firebase/firestore';
import type { ClassRoom, Session, Student, Subject, TimetableSeries, UserProfile, WithId } from '@/types/models';

const DAYS = [['Mon', 1], ['Tue', 2], ['Wed', 3], ['Thu', 4], ['Fri', 5], ['Sat', 6], ['Sun', 0]] as const;
const PROVIDERS = [['google_meet', 'Google Meet'], ['zoom', 'Zoom'], ['teams', 'Microsoft Teams'], ['other', 'Other']] as const;
interface Course { title: string }

export function SessionForm({ open, onClose, session, initialDate, onDone }: {
  open: boolean; onClose: () => void; session?: WithId<Session> | null; initialDate?: string; onDone?: () => void;
}) {
  const { uid, role, profile } = useAuth();
  const toast = useToast();
  const editing = !!session;
  const leader = role === 'super_admin' || role === 'admin' || role === 'principal';

  const classes = useCollection<ClassRoom>(C.classes, () => (open ? [] : null), open ? 'o' : 'c');
  const subjects = useCollection<Subject>(C.subjects, () => (open ? [] : null), open ? 'o' : 'c');
  const courses = useCollection<Course>(C.courses, () => (open ? [] : null), open ? 'o' : 'c');
  const students = useCollection<Student>(C.students, () => (open ? [] : null), open ? 'o' : 'c');
  const users = useCollection<UserProfile>(C.users, () => (open && leader ? [] : null), open && leader ? 'o' : 'c');
  const teachers = useMemo(() => (leader ? users.data.filter((u) => u.status === 'active' && rolesOf(u).includes('teacher')) : []), [leader, users.data]);

  const blank = () => ({
    title: '', description: '', courseId: '', subjectId: '', classId: '', teacherUid: leader ? '' : (uid ?? ''), location: '',
    date: initialDate ?? new Date().toISOString().slice(0, 10), start: '10:00', end: '11:00',
    online: false, provider: 'google_meet', url: '', meetingId: '', passcode: '', notify: true,
  });
  const [f, setF] = useState(blank());
  const [rec, setRec] = useState<Recurrence>(defaultRecurrence());
  const [scope, setScope] = useState<Scope>('one');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [audClass, setAudClass] = useState('');
  const [search, setSearch] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // initialise when opened
  useEffect(() => {
    if (!open) return;
    setScope('one'); setTouched(false); setSearch(''); setRec(defaultRecurrence());
    if (!session) { setF(blank()); setSel(new Set()); setAudClass(''); return; }
    const z0 = utcToZoned(toDate(session.startAt)!, session.timezone); const z1 = utcToZoned(toDate(session.endAt)!, session.timezone);
    setF({ title: session.title, description: session.description ?? '', courseId: session.courseId ?? '', subjectId: session.subjectId ?? '', classId: session.classId ?? '', teacherUid: session.teacherUid, location: session.location ?? '',
      date: z0.date, start: z0.time, end: z1.time, online: session.online, provider: session.provider || 'google_meet', url: '', meetingId: '', passcode: '', notify: true });
    setAudClass(session.classId ?? '');
    void getById<TimetableSeries>(C.timetableSeries, session.seriesId).then((s) => setSel(new Set(s?.studentIds ?? []))).catch(() => setSel(new Set()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.id]);

  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));
  const active = students.data.filter((s) => s.status === 'active');
  const classMembers = active.filter((s) => audClass && s.classId === audClass);
  const others = active.filter((s) => (!audClass || s.classId !== audClass) && `${s.firstName} ${s.lastName}`.toLowerCase().includes(search.toLowerCase())).slice(0, 25);
  const toggle = (id: string) => { setTouched(true); setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const pickClass = (id: string) => { setTouched(true); setAudClass(id); setSel((p) => { const n = new Set([...p].filter((x) => !classMembers.some((m) => m.id === x))); active.filter((s) => s.classId === id).forEach((s) => n.add(s.id)); return n; }); if (!f.classId) set('classId', id); };

  const audience = () => {
    const chosen = active.filter((s) => sel.has(s.id));
    return {
      studentIds: chosen.map((s) => s.id), studentUids: [...new Set(chosen.map((s) => s.studentUid).filter(Boolean))],
      parentUids: [...new Set(chosen.flatMap((s) => s.parentUids ?? []))],
      excludedStudentIds: classMembers.filter((s) => !sel.has(s.id)).map((s) => s.id),
    };
  };
  const noLogin = active.filter((s) => sel.has(s.id) && !s.studentUid).length;

  /* ---- live conflict preview: the same check Save runs, shown while the person is still choosing times ---- */
  const siblingsRef = useRef<{ seriesId: string; rows: WithId<Session>[] } | null>(null);
  const previewCheck = useCallback(async (): Promise<Issue[]> => {
    if (!uid) return [];
    let dates: string[] | undefined; let exclude: string[] | undefined;
    if (editing && session) {
      if (siblingsRef.current?.seriesId !== session.seriesId) siblingsRef.current = { seriesId: session.seriesId, rows: await listDocs<Session>(C.sessions, [where('seriesId', '==', session.seriesId)]) };
      const t = scopeTargets(siblingsRef.current.rows.map((r) => ({ id: r.id, status: r.status, overridden: r.overridden, startMs: toDate(r.startAt)?.getTime() ?? 0, localDate: r.localDate, seriesIndex: r.seriesIndex })), session, scope, Date.now());
      dates = t.dates; exclude = t.exclude;
    }
    const issues = await checkSchedule({ title: f.title, teacherUid: f.teacherUid, classId: editing ? (session?.classId || undefined) : (f.classId || undefined), subjectId: f.subjectId || undefined, courseId: f.courseId || undefined, startDate: f.date, startTime: f.start, endTime: f.end, recurrence: editing ? defaultRecurrence() : rec },
      { leader, myUid: uid, excludeIds: exclude, dates });
    return previewIssues(issues);
  }, [uid, editing, session, scope, f.title, f.teacherUid, f.classId, f.subjectId, f.courseId, f.date, f.start, f.end, rec, leader]);
  const liveKey = JSON.stringify([session?.id ?? '', scope, f.teacherUid, f.classId, f.subjectId, f.courseId, f.date, f.start, f.end, editing ? '' : rec]);
  const live = useLiveIssues(previewCheck, liveKey, open && !!f.teacherUid && !!f.date && !!f.start && !!f.end);
  const liveErrors = live.issues.filter((i) => i.level === 'error'); const liveWarnings = live.issues.filter((i) => i.level === 'warning');

  const submit = async () => {
    if (!uid) return;
    if (!f.title.trim()) return toast.error('Give the class a title.');
    if (!f.teacherUid) return toast.error('Choose the teacher.');
    if (f.end <= f.start) return toast.error('End time must be after the start time.');
    if (f.online && !editing && !f.url.trim()) return toast.error('Enter the meeting link, or untick “Online class”.');
    const teacherName = leader ? (teachers.find((t) => t.id === f.teacherUid)?.displayName ?? session?.teacherName ?? '') : (profile?.displayName ?? '');
    const course = courses.data.find((c) => c.id === f.courseId); const subj = subjects.data.find((s) => s.id === f.subjectId); const cls = classes.data.find((c) => c.id === f.classId);
    const link = f.online && f.url.trim() ? { provider: f.provider, meetingUrl: f.url, meetingId: f.meetingId, passcode: f.passcode } : undefined;
    const by = { uid, name: profile?.displayName ?? '' };
    setBusy(true);
    try {
      // conflict / validity checks before anything is written
      let dates: string[] | undefined; let exclude: string[] | undefined;
      if (editing) {
        const sib = await listDocs<Session>(C.sessions, [where('seriesId', '==', session!.seriesId)]);
        const t = scopeTargets(sib.map((r) => ({ id: r.id, status: r.status, overridden: r.overridden, startMs: toDate(r.startAt)?.getTime() ?? 0, localDate: r.localDate, seriesIndex: r.seriesIndex })), session!, scope, Date.now());
        dates = t.dates; exclude = t.exclude;
      }
      const issues = await checkSchedule({ title: f.title, teacherUid: f.teacherUid, classId: editing ? (session!.classId || undefined) : (f.classId || undefined), subjectId: f.subjectId || undefined, courseId: f.courseId || undefined, startDate: f.date, startTime: f.start, endTime: f.end, recurrence: editing ? defaultRecurrence() : rec },
        { leader, myUid: uid, excludeIds: exclude, dates });
      if (hasErrors(issues)) { toast.error(issues.filter((i) => i.level === 'error').map((i) => i.message).join(' ')); setBusy(false); return; }
      const warn = issues.filter((i) => i.level === 'warning');
      if (warn.length && !window.confirm(`${warn.map((i) => '• ' + i.message).join('\n')}\n\nSchedule anyway?`)) { setBusy(false); return; }
      if (!editing) {
        if (rec.freq !== 'none' && rec.end.type === 'date' && rec.end.until < f.date) throw new Error('The end date must be on or after the first class.');
        const a = audience();
        const input: SeriesInput = { title: f.title.trim(), description: f.description, courseId: f.courseId, courseName: course?.title ?? '', subjectId: f.subjectId, subjectName: subj?.name ?? '', classId: f.classId, className: cls?.name ?? '',
          teacherUid: f.teacherUid, teacherName, location: f.location, link, startDate: f.date, startTime: f.start, endTime: f.end, timezone: DEFAULT_TZ, recurrence: rec, ...a, notify: f.notify };
        const r = await createSeries(input, by);
        toast.success(`${r.count} session${r.count === 1 ? '' : 's'} scheduled`);
      } else {
        const ch: EditChanges = { title: f.title.trim(), description: f.description, courseId: f.courseId, courseName: course?.title ?? '', subjectId: f.subjectId, subjectName: subj?.name ?? '', teacherUid: f.teacherUid, teacherName, location: f.location,
          startTime: f.start, endTime: f.end, ...(link ? { link } : {}), ...(touched ? { audience: audience() } : {}) };
        const n = await editSessions(session!, scope, ch, by, leader, f.notify);
        toast.success(`${n} session${n === 1 ? '' : 's'} updated`);
      }
      onDone?.(); onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onClose={onClose} size="xl" title={editing ? 'Edit class' : 'Schedule a class'} description={`Times are in ${DEFAULT_TZ} (WAT). ${editing ? '' : `A repeating class can create up to ${MAX_OCCURRENCES} sessions.`}`}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>{editing ? 'Save changes' : 'Schedule'}</Button></>}>
      <div className="space-y-6">
        {editing && (
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Apply changes to</legend>
            {([['one', 'This session only'], ['future', 'This and all later sessions'], ['all', 'The whole series (upcoming sessions)']] as const).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 py-1 text-sm"><input type="radio" name="scope" className="accent-forest-700" checked={scope === v} onChange={() => setScope(v)} />{l}</label>))}
            <p className="mt-1 text-xs text-muted">Past, cancelled and individually edited sessions are never changed by “later” or “whole series”.</p>
          </fieldset>)}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required className="sm:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />}</Field>
          <Field label="Course">{(a) => <Select {...a} value={f.courseId} onChange={(e) => set('courseId', e.target.value)}><option value="">— none —</option>{courses.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
          <Field label="Subject">{(a) => <Select {...a} value={f.subjectId} onChange={(e) => set('subjectId', e.target.value)}><option value="">— none —</option>{subjects.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Class / group">{(a) => <Select {...a} value={f.classId} onChange={(e) => set('classId', e.target.value)}><option value="">— none —</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="Teacher" required>{(a) => leader
            ? <Select {...a} value={f.teacherUid} onChange={(e) => set('teacherUid', e.target.value)}><option value="">Select…</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.displayName}</option>)}</Select>
            : <Input {...a} value={profile?.displayName ?? ''} readOnly />}</Field>
          <Field label={editing ? 'Date (use Reschedule to move one session)' : 'First class date'} required>{(a) => <Input {...a} type="date" value={f.date} disabled={editing} onChange={(e) => set('date', e.target.value)} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" required>{(a) => <Input {...a} type="time" value={f.start} onChange={(e) => set('start', e.target.value)} />}</Field>
            <Field label="Ends" required>{(a) => <Input {...a} type="time" value={f.end} onChange={(e) => set('end', e.target.value)} />}</Field>
          </div>
          <Field label="Location (physical, optional)" className="sm:col-span-2">{(a) => <Input {...a} value={f.location} onChange={(e) => set('location', e.target.value)} />}</Field>
          <Field label="Description" className="sm:col-span-2">{(a) => <Textarea {...a} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
        </div>

        <div role="status" aria-live="polite" data-testid="live-conflicts" className="rounded-md border border-line p-3 text-sm">
          {!f.teacherUid ? <p className="text-muted">Choose a teacher to check the timetable for clashes.</p>
            : live.checking ? <p className="text-muted">Checking the timetable…</p>
            : live.failed ? <p className="text-muted">Could not check the timetable just now. Saving will check again.</p>
            : liveErrors.length === 0 && liveWarnings.length === 0 ? <p className="text-ok">No clashes found for these times.</p>
            : <ul className="space-y-1">{liveErrors.map((i) => <li key={i.code + i.message} className="text-danger">✕ {i.message}</li>)}{liveWarnings.map((i) => <li key={i.code + i.message} className="text-warn">! {i.message}</li>)}</ul>}
          {!leader && <p className="mt-1 text-xs text-muted">You can only see your own classes here. Clashes with other teachers’ classes are checked by school leaders.</p>}
          {liveErrors.length > 0 && <p className="mt-1 text-xs text-muted">Saving is blocked until these are fixed.</p>}
        </div>

        <fieldset className="space-y-3 rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Online meeting</legend>
          <Checkbox label="This is an online class" checked={f.online} disabled={editing && !!session?.online} onChange={(e) => set('online', e.target.checked)} />
          {f.online && (<div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">{(a) => <Select {...a} value={f.provider} onChange={(e) => set('provider', e.target.value)}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
            <Field label={editing ? 'Meeting link (leave blank to keep the current one)' : 'Meeting link (https://…)'}>{(a) => <Input {...a} type="url" inputMode="url" value={f.url} onChange={(e) => set('url', e.target.value)} />}</Field>
            <Field label="Meeting ID (optional)">{(a) => <Input {...a} value={f.meetingId} onChange={(e) => set('meetingId', e.target.value)} />}</Field>
            <Field label="Passcode (optional)">{(a) => <Input {...a} value={f.passcode} onChange={(e) => set('passcode', e.target.value)} autoComplete="off" />}</Field>
            <p className="text-xs text-muted sm:col-span-2">The link is stored separately and is released by the database only to the invited audience, from 15 minutes before the start.</p>
          </div>)}
        </fieldset>

        {!editing && (
          <fieldset className="space-y-3 rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Repeat</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Repeats">{(a) => <Select {...a} value={rec.freq} onChange={(e) => setRec({ ...rec, freq: e.target.value as Recurrence['freq'] })}><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select>}</Field>
              {rec.freq !== 'none' && <Field label={`Every (${rec.freq === 'daily' ? 'days' : rec.freq === 'weekly' ? 'weeks' : 'months'})`}>{(a) => <Input {...a} type="number" min={1} max={12} value={rec.interval} onChange={(e) => setRec({ ...rec, interval: Math.max(1, Number(e.target.value) || 1) })} />}</Field>}
              {rec.freq !== 'none' && <Field label="Ends">{(a) => <Select {...a} value={rec.end.type} onChange={(e) => setRec({ ...rec, end: e.target.value === 'count' ? { type: 'count', count: 10 } : { type: 'date', until: f.date } })}><option value="count">After a number of sessions</option><option value="date">On a date</option></Select>}</Field>}
            </div>
            {rec.freq === 'weekly' && (<div><p className="mb-1 text-sm">On</p><div className="flex flex-wrap gap-1.5">{DAYS.map(([l, n]) => <button key={n} type="button" aria-pressed={rec.weekdays.includes(n)} onClick={() => setRec({ ...rec, weekdays: rec.weekdays.includes(n) ? rec.weekdays.filter((x) => x !== n) : [...rec.weekdays, n] })} className={`h-9 min-w-11 rounded border px-2 text-sm ${rec.weekdays.includes(n) ? 'border-forest-700 bg-forest-700 text-white' : 'border-line bg-white'}`}>{l}</button>)}</div><p className="mt-1 text-xs text-muted">None selected = the weekday of the first class.</p></div>)}
            {rec.freq !== 'none' && rec.end.type === 'count' && <Field label="Number of sessions">{(a) => <Input {...a} type="number" min={1} max={MAX_OCCURRENCES} value={rec.end.type === 'count' ? rec.end.count : 1} onChange={(e) => setRec({ ...rec, end: { type: 'count', count: Math.min(MAX_OCCURRENCES, Math.max(1, Number(e.target.value) || 1)) } })} />}</Field>}
            {rec.freq !== 'none' && rec.end.type === 'date' && <Field label="Last possible date">{(a) => <Input {...a} type="date" value={rec.end.type === 'date' ? rec.end.until : ''} onChange={(e) => setRec({ ...rec, end: { type: 'date', until: e.target.value } })} />}</Field>}
          </fieldset>)}

        <fieldset className="space-y-3 rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Who attends</legend>
          <p className="text-xs text-muted">Only the learners ticked here — and their linked parents or guardians — can see this class or its link.{editing && !touched ? ' Leave as is to keep the current audience.' : ''}</p>
          <Field label="Add a whole class">{(a) => <Select {...a} value={audClass} onChange={(e) => pickClass(e.target.value)}><option value="">Select a class…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          {classMembers.length > 0 && (<div><p className="mb-1 text-sm">Untick anyone to exclude them</p><div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">{classMembers.map((s) => <Checkbox key={s.id} label={`${s.firstName} ${s.lastName}${s.studentUid ? '' : ' (no login)'}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} />)}</div></div>)}
          <Field label="Add individual learners from other classes">{(a) => <Input {...a} placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />}</Field>
          {search && <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">{others.map((s) => <Checkbox key={s.id} label={`${s.firstName} ${s.lastName} — ${s.className ?? '—'}`} checked={sel.has(s.id)} onChange={() => toggle(s.id)} />)}</div>}
          <p className="text-sm"><strong>{sel.size}</strong> learner(s) selected{noLogin > 0 && <span className="text-warn"> · {noLogin} have no student login yet (their parents will still see the class)</span>}.</p>
        </fieldset>

        <Checkbox label="Notify the teacher, learners and parents" checked={f.notify} onChange={(e) => set('notify', e.target.checked)} />
        <p className="text-xs text-muted">Example start: {format12(f.start)} WAT.</p>
      </div>
    </Dialog>
  );
}
