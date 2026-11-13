import { useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { EmptyState, Progress, Spinner } from '@/components/ui/data';
import { Field, Select, Textarea } from '@/components/ui/form';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { daysSince, summariseChild, type EnrolLite } from '@/lib/learning';
import { errorMessage, toDate } from '@/lib/utils';
import { sendFeedback } from '@/services/learning';
import type { ClassRoom, CourseEnrollment, LearningFeedback, LessonActivity, Student, WithId } from '@/types/models';

type Sub = { uid: string; status: string; score?: number | null };
const ms = (v: unknown) => toDate(v)?.getTime() ?? 0;

/** One learner's picture, built only from stored records. Nothing is estimated. */
function ChildCard({ name, enrols, subs, acts, feedback }: { name: string; enrols: WithId<CourseEnrollment>[]; subs: Sub[]; acts: LessonActivity[]; feedback: LearningFeedback[] }) {
  const lite: EnrolLite[] = enrols.map((e) => ({ courseId: e.courseId, courseTitle: e.courseTitle, progressPct: e.progressPct, completedLessons: e.completedLessons, totalLessons: e.totalLessons, lastActivityMs: ms(e.lastActivityAt) || undefined, status: e.status }));
  const s = summariseChild(lite, subs, acts.map((a) => ms(a.viewedAt)));
  const idle = daysSince(s.lastActivityMs);
  return (
    <Card><CardBody className="space-y-3">
      <h2 className="text-lg font-semibold">{name}</h2>
      {!s.hasData ? <p className="text-sm text-muted">No learning activity has been recorded yet.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div><dt className="text-muted">Average course progress</dt><dd className="text-lg font-semibold">{s.avgProgress == null ? '—' : `${s.avgProgress}%`}</dd></div>
            <div><dt className="text-muted">Lessons completed</dt><dd className="text-lg font-semibold">{s.lessonsDone}</dd></div>
            <div><dt className="text-muted">Assignments submitted</dt><dd className="text-lg font-semibold">{s.submitted} <span className="text-xs font-normal text-muted">({s.marked} marked)</span></dd></div>
            <div><dt className="text-muted">Last learning activity</dt><dd className="text-lg font-semibold">{idle == null ? 'None recorded' : idle === 0 ? 'Today' : `${idle} day${idle === 1 ? '' : 's'} ago`}</dd></div>
          </dl>
          {enrols.length > 0 && (
            <ul className="space-y-2">{enrols.map((e) => (
              <li key={e.id}><div className="flex justify-between text-sm"><span>{e.courseTitle}</span><span className="text-muted">{e.completedLessons} of {e.totalLessons ?? '?'} lessons · {e.progressPct}%</span></div><Progress value={e.progressPct} /></li>
            ))}</ul>
          )}
        </>
      )}
      {feedback.length > 0 && (
        <div><h3 className="mb-1 text-sm font-semibold">Messages from teachers</h3>
          <ul className="space-y-2">{[...feedback].sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).slice(0, 5).map((f) => (
            <li key={`${f.teacherUid}${ms(f.createdAt)}${f.message.slice(0, 8)}`} className="rounded-md bg-cream px-3 py-2 text-sm"><p>{f.message}</p><p className="mt-1 text-xs text-muted">{f.teacherName}{f.courseTitle ? ` · ${f.courseTitle}` : ''} · {toDate(f.createdAt)?.toLocaleDateString() ?? ''}</p></li>
          ))}</ul></div>
      )}
    </CardBody></Card>
  );
}

function ParentView() {
  const { uid } = useAuth();
  const key = uid ?? '';
  const by = () => (uid ? [where('parentUids', 'array-contains', uid)] : null);
  const kids = useCollection<Student>(C.students, by, key);
  const enr = useCollection<CourseEnrollment>(C.courseEnrollments, by, key);
  const acts = useCollection<LessonActivity>(C.lessonActivity, by, key);
  const subs = useCollection<Sub>(C.submissions, by, key);
  const fb = useCollection<LearningFeedback>(C.learningFeedback, by, key);
  if (kids.loading || enr.loading) return <Spinner />;
  if (kids.data.length === 0) return <EmptyState title="No children linked yet" description="Ask the school office to link your child to your account." />;
  return (
    <div className="space-y-4">
      {kids.data.map((k) => (
        <ChildCard key={k.id} name={`${k.firstName} ${k.lastName}`}
          enrols={k.studentUid ? enr.data.filter((e) => e.uid === k.studentUid) : []} subs={k.studentUid ? subs.data.filter((s) => s.uid === k.studentUid) : []}
          acts={k.studentUid ? acts.data.filter((a) => a.uid === k.studentUid) : []} feedback={fb.data.filter((f) => f.studentId === k.id)} />
      ))}
      {kids.data.some((k) => !k.studentUid) && <p className="text-xs text-muted">Some children have no learner login yet, so no online learning can be shown for them.</p>}
      <p className="text-xs text-muted">Figures come only from what your child has actually done on the platform. Watching a video outside the school site, or working offline, is not counted.</p>
    </div>
  );
}

function StaffView() {
  const { uid, role, profile } = useAuth(); const toast = useToast();
  const leader = ['super_admin', 'admin', 'principal'].includes(role ?? '');
  const [classId, setClassId] = useState(''); const [studentId, setStudentId] = useState(''); const [courseId, setCourseId] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  const classes = useCollection<ClassRoom>(C.classes, () => []);
  const students = useCollection<Student>(C.students, () => (classId ? [where('classId', '==', classId)] : null), classId);
  const student = students.data.find((s) => s.id === studentId);
  const sUid = student?.studentUid ?? '';
  const enr = useCollection<CourseEnrollment>(C.courseEnrollments, () => (sUid ? [where('uid', '==', sUid)] : null), sUid);
  const subs = useCollection<Sub>(C.submissions, () => (sUid ? [where('uid', '==', sUid)] : null), sUid);
  const acts = useCollection<LessonActivity>(C.lessonActivity, () => (sUid ? [where('uid', '==', sUid)] : null), sUid);
  const sent = useCollection<LearningFeedback>(C.learningFeedback, () => (leader ? [] : uid ? [where('teacherUid', '==', uid)] : null), `${leader}${uid}`);
  const fbFor = useMemo(() => sent.data.filter((f) => f.studentId === studentId), [sent.data, studentId]);
  const send = async () => {
    if (!student || !uid) return;
    setBusy(true);
    try {
      await sendFeedback({ studentId: student.id, studentUid: sUid, studentName: `${student.firstName} ${student.lastName}`, parentUids: student.parentUids ?? [], courseId: courseId || undefined, courseTitle: enr.data.find((e) => e.courseId === courseId)?.courseTitle, message, teacherUid: uid, teacherName: profile?.displayName ?? '' });
      setMessage(''); toast.success('Message sent to the parent(s).');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card><CardBody className="grid gap-3 sm:grid-cols-2">
        <Field label="Class">{(p) => <Select {...p} value={classId} onChange={(e) => { setClassId(e.target.value); setStudentId(''); setCourseId(''); }}><option value="">Choose…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <Field label="Learner">{(p) => <Select {...p} value={studentId} disabled={!classId} onChange={(e) => { setStudentId(e.target.value); setCourseId(''); }}><option value="">Choose…</option>{students.data.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}</Select>}</Field>
      </CardBody></Card>
      {student && (
        <>
          <ChildCard name={`${student.firstName} ${student.lastName}`} enrols={enr.data} subs={subs.data} acts={acts.data} feedback={fbFor} />
          <Card><CardBody className="space-y-3">
            <h2 className="font-semibold">Send a message to the parent(s)</h2>
            {(student.parentUids ?? []).length === 0 && <p className="text-sm text-danger">No parent or guardian is linked to this learner yet.</p>}
            <Field label="About a course (optional)">{(p) => <Select {...p} value={courseId} onChange={(e) => setCourseId(e.target.value)}><option value="">General</option>{enr.data.map((e) => <option key={e.id} value={e.courseId}>{e.courseTitle}</option>)}</Select>}</Field>
            <Field label="Message" required hint={`${message.length}/1000`}>{(p) => <Textarea {...p} maxLength={1000} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <Button onClick={() => void send()} disabled={busy || !message.trim() || (student.parentUids ?? []).length === 0}>Send message</Button>
          </CardBody></Card>
        </>
      )}
    </div>
  );
}

export function MonitorPage() {
  const { role } = useAuth();
  return (
    <div>
      <PageHeader title="Learning monitor" description={role === 'parent' ? 'How your children are doing in online lessons and courses.' : 'See a learner’s recorded progress and send feedback to their parents.'} />
      {role === 'parent' ? <ParentView /> : <StaffView />}
    </div>
  );
}
