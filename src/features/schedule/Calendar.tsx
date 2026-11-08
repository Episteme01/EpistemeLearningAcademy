import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { ChevronLeft, ChevronRight, Plus, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { EmptyState, Spinner, Tabs } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { addDays } from '@/lib/schedule/recurrence';
import { monthGrid, shiftMonth, weekDates } from '@/lib/schedule/calendar';
import { DEFAULT_TZ, browserTz, format12, utcToZoned } from '@/lib/schedule/tz';
import { cn, toDate } from '@/lib/utils';
import type { Session, Student, WithId } from '@/types/models';
import { SessionDialog } from './SessionDialog';
import { SessionForm } from './SessionForm';
import { useSessions } from './useSessions';

type View = 'day' | 'week' | 'month' | 'agenda';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const label = (d: string) => { const [y, m, day] = d.split('-').map(Number) as [number, number, number]; const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]} ${day} ${MONTHS[m - 1]!.slice(0, 3)}`; };

export function CalendarPage({ liveOnly = false }: { liveOnly?: boolean }) {
  const { uid, role } = useAuth();
  const leader = role === 'super_admin' || role === 'admin' || role === 'principal' || role === 'director';
  const canSchedule = role === 'super_admin' || role === 'admin' || role === 'principal' || role === 'teacher';
  const [tzMode, setTzMode] = useState<'school' | 'local'>('school');
  const local = browserTz();
  const tz = tzMode === 'local' ? local : DEFAULT_TZ;
  const today = utcToZoned(new Date(), tz).date;
  const [view, setView] = useState<View>(liveOnly ? 'agenda' : 'week');
  const [cursor, setCursor] = useState(today);
  const [picked, setPicked] = useState(today);
  const [fClass, setFClass] = useState(''); const [fTeacher, setFTeacher] = useState('');
  const [fChild, setFChild] = useState('');
  const [open, setOpen] = useState<WithId<Session> | null>(null);
  // Parents: load their linked children so each class is labelled by child.
  const kids = useCollection<Student>(C.students, () => (role === 'parent' && uid ? [where('parentUids', 'array-contains', uid)] : null), role === 'parent' ? (uid ?? '') : '');
  const [form, setForm] = useState<{ session: WithId<Session> | null } | null>(null);

  const dates = useMemo(() => {
    if (view === 'day') return [cursor];
    if (view === 'week') return weekDates(cursor);
    if (view === 'month') return monthGrid(cursor);
    return Array.from({ length: 45 }, (_, i) => addDays(cursor, i));
  }, [view, cursor]);
  // Fetch one day either side so sessions near midnight in another time zone are not lost.
  const fetchDates = useMemo(() => [addDays(dates[0]!, -1), ...dates, addDays(dates[dates.length - 1]!, 1)], [dates]);
  const { sessions, loading, error } = useSessions(fetchDates, uid, leader);

  const all = useMemo(() => sessions
    // Workspace scoping: a Teacher+Parent sees only their teaching in the Teacher workspace and only their children's classes in the Parent workspace.
    .filter((s) => (role === 'teacher' ? s.teacherUid === uid : role === 'parent' ? !!uid && s.parentUids.includes(uid) : role === 'student' ? !!uid && s.studentUids.includes(uid) : true))
    .filter((s) => !fChild || (kids.data.find((k) => k.id === fChild)?.studentUid ? s.studentUids.includes(kids.data.find((k) => k.id === fChild)!.studentUid) : false))
    .filter((s) => (!liveOnly || s.online) && (!fClass || s.classId === fClass) && (!fTeacher || s.teacherUid === fTeacher))
    .sort((a, b) => (toDate(a.startAt)?.getTime() ?? 0) - (toDate(b.startAt)?.getTime() ?? 0)), [sessions, liveOnly, fClass, fTeacher, fChild, role, uid, kids.data]);
  const byDay = useMemo(() => {
    const m = new Map<string, WithId<Session>[]>();
    for (const s of all) { const d = utcToZoned(toDate(s.startAt)!, tz).date; (m.get(d) ?? m.set(d, []).get(d)!).push(s); }
    return m;
  }, [all, tz]);

  const classOpts = useMemo(() => [...new Map(sessions.filter((s) => s.classId).map((s) => [s.classId!, s.className ?? s.classId!])).entries()], [sessions]);
  const teacherOpts = useMemo(() => [...new Map(sessions.map((s) => [s.teacherUid, s.teacherName])).entries()], [sessions]);

  const step = (dir: 1 | -1) => setCursor((c) => view === 'month' ? shiftMonth(c, dir) : addDays(c, dir * (view === 'day' ? 1 : view === 'week' ? 7 : 45)));
  const [cy, cm] = cursor.split('-').map(Number) as [number, number];
  const title = view === 'month' ? `${MONTHS[cm - 1]} ${cy}` : view === 'day' ? label(cursor) : view === 'week' ? `${label(dates[0]!)} – ${label(dates[6]!)}` : `Next 45 days from ${label(cursor)}`;

  const Event = ({ s, compact }: { s: WithId<Session>; compact?: boolean }) => {
    const a = utcToZoned(toDate(s.startAt)!, tz); const b = utcToZoned(toDate(s.endAt)!, tz);
    const cancelled = s.status === 'cancelled';
    return (
      <button type="button" onClick={() => setOpen(s)} className={cn('w-full rounded-md border px-3 py-2 text-left hover:bg-forest-50', cancelled ? 'border-danger/30 bg-danger/5' : s.status === 'completed' ? 'border-line bg-cream' : 'border-forest-200 bg-white')}>
        <span className="flex items-center justify-between gap-2 text-xs text-muted"><span>{format12(a.time)} – {format12(b.time)}</span>{s.online && <Video className="h-3.5 w-3.5 shrink-0" aria-label="Online" />}</span>
        <span className={cn('block text-sm font-medium', cancelled && 'line-through')}>{s.title}</span>
        {role === 'parent' && (() => { const n = kids.data.filter((k) => k.studentUid && s.studentUids.includes(k.studentUid)).map((k) => k.firstName); return n.length ? <span className="mt-0.5 inline-block rounded bg-gold-50 px-1.5 text-[11px] text-forest-800">For {n.join(', ')}</span> : null; })()}
        {!compact && <span className="block text-xs text-muted">{[s.className, s.subjectName, s.teacherName].filter(Boolean).join(' · ')}{cancelled ? ' · Cancelled' : s.rescheduledFrom != null ? ' · Rescheduled' : ''}</span>}
      </button>
    );
  };

  const dayList = (d: string) => { const l = byDay.get(d) ?? []; return l.length ? <ul className="space-y-2">{l.map((s) => <li key={s.id}><Event s={s} /></li>)}</ul> : <p className="text-sm text-muted">No classes.</p>; };

  return (
    <>
      <PageHeader title={liveOnly ? 'Live classes' : 'Timetable'} description={liveOnly ? 'Online classes you are invited to. Join links unlock 15 minutes before each class.' : leader ? 'School-wide calendar. Filter by class or teacher.' : 'Your personal timetable.'}
        actions={canSchedule ? <Button onClick={() => setForm({ session: null })}><Plus className="h-4 w-4" /> Schedule class</Button> : undefined} />
      <Card><CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" aria-label="Next" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => { setCursor(today); setPicked(today); }}>Today</Button>
          <h2 className="ml-1 font-heading text-base font-semibold sm:text-lg">{title}</h2>
          {local !== DEFAULT_TZ && <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTzMode(tzMode === 'school' ? 'local' : 'school')}>{tzMode === 'school' ? `Show my time (${local})` : 'Show Lagos time (WAT)'}</Button>}
        </div>
        <Tabs<View> value={view} onChange={setView} tabs={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'agenda', label: 'Agenda' }]} />
        {role === 'parent' && kids.data.length > 1 && (
          <Select aria-label="Filter by child" className="w-auto" value={fChild} onChange={(e) => setFChild(e.target.value)}><option value="">All my children</option>{kids.data.map((k) => <option key={k.id} value={k.id}>{k.firstName} {k.lastName}</option>)}</Select>)}
        {leader && (classOpts.length > 0 || teacherOpts.length > 1) && (
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Filter by class" className="w-auto" value={fClass} onChange={(e) => setFClass(e.target.value)}><option value="">All classes</option>{classOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
            <Select aria-label="Filter by teacher" className="w-auto" value={fTeacher} onChange={(e) => setFTeacher(e.target.value)}><option value="">All teachers</option>{teacherOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</Select>
          </div>)}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {loading ? <Spinner /> : (
          <>
            {view === 'day' && dayList(cursor)}
            {view === 'week' && <div className="grid gap-3 md:grid-cols-7">{dates.map((d) => <section key={d} aria-label={label(d)} className={cn('min-w-0 rounded-md border p-2', d === today ? 'border-gold-400 bg-gold-50/40' : 'border-line')}><h3 className="mb-2 text-xs font-semibold text-muted">{label(d)}</h3>{(byDay.get(d) ?? []).length ? <ul className="space-y-2">{byDay.get(d)!.map((s) => <li key={s.id}><Event s={s} compact /></li>)}</ul> : <p className="text-xs text-muted">—</p>}</section>)}</div>}
            {view === 'month' && (
              <div>
                <div className="grid grid-cols-7 text-center text-xs text-muted">{DOW.map((d) => <div key={d} className="py-1">{d}</div>)}</div>
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-line bg-line">
                  {dates.map((d) => { const l = byDay.get(d) ?? []; const inMonth = d.slice(0, 7) === cursor.slice(0, 7); return (
                    <button key={d} type="button" onClick={() => setPicked(d)} aria-label={`${label(d)}, ${l.length} classes`} className={cn('min-h-14 bg-white p-1 text-left align-top hover:bg-forest-50 md:min-h-24', !inMonth && 'bg-cream/60 text-muted', d === picked && 'ring-2 ring-inset ring-forest-600')}>
                      <span className={cn('inline-grid h-6 w-6 place-items-center rounded-full text-xs', d === today && 'bg-forest-700 text-white')}>{Number(d.slice(8))}</span>
                      <span className="mt-0.5 hidden md:block">{l.slice(0, 2).map((s) => <span key={s.id} className={cn('block truncate text-[11px]', s.status === 'cancelled' && 'line-through text-danger')}>{format12(utcToZoned(toDate(s.startAt)!, tz).time)} {s.title}</span>)}{l.length > 2 && <span className="text-[11px] text-muted">+{l.length - 2} more</span>}</span>
                      {l.length > 0 && <span className="mt-1 flex gap-0.5 md:hidden">{l.slice(0, 4).map((s) => <span key={s.id} className="h-1.5 w-1.5 rounded-full bg-forest-600" />)}</span>}
                    </button>); })}
                </div>
                <div className="mt-4"><h3 className="mb-2 text-sm font-semibold">{label(picked)}</h3>{dayList(picked)}</div>
              </div>)}
            {view === 'agenda' && (() => {
              const days = dates.filter((d) => (byDay.get(d) ?? []).length);
              return days.length === 0 ? <EmptyState title="Nothing scheduled" description={liveOnly ? 'No online classes in the next 45 days.' : 'No classes in the next 45 days.'} /> : <div className="space-y-4">{days.map((d) => <section key={d}><h3 className="mb-1.5 text-sm font-semibold">{label(d)}{d === today && <span className="ml-2 text-xs font-normal text-forest-600">Today</span>}</h3>{dayList(d)}</section>)}</div>;
            })()}
          </>)}
        <p className="text-xs text-muted">Times shown in {tzMode === 'local' ? local : 'Lagos (WAT)'}.</p>
      </CardBody></Card>

      <SessionDialog session={open} tz={tz} onClose={() => setOpen(null)} onEdit={(s) => { setOpen(null); setForm({ session: s }); }} />
      <SessionForm open={!!form} session={form?.session ?? null} initialDate={picked} onClose={() => setForm(null)} />
    </>
  );
}
