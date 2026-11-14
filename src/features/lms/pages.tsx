import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { CheckCircle2, Circle, FileText, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { EntityForm } from '@/components/common/EntityForm';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card';
import { Field, Select } from '@/components/ui/form';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/overlay';
import { Badge, EmptyState, Progress, Spinner, StatusBadge } from '@/components/ui/data';
import { Rich } from '@/features/public/pages';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { can } from '@/config/permissions';
import { createDoc, getById, patchDoc, removeDoc } from '@/services/db';
import { enrolClass, enrolStudent, setLessonComplete } from '@/services/lms';
import { errorMessage, slugify } from '@/lib/utils';
import type { ClassRoom, Course, CourseEnrollment, CourseModule, Lesson, LessonActivity, LessonPlan, Student, WithId } from '@/types/models';
import { ITEM_LABEL, completesOnSubmit, itemProblem, studioToHtml } from '@/lib/courseItems';
import { AssignmentEmbed, QuizEmbed } from './embeds';
import { QuizTake } from './work';
import { ResourceViewer } from '@/features/learning/LessonMedia';
import { PresentationViewer, VideoPlayer } from '@/features/learning/Viewers';
import { canComplete, isTrackable, googleSlidesEmbed } from '@/lib/learning';
import { parseVideoUrl } from '@/lib/spotlight';
import { saveActivity } from '@/services/learning';

type Row = Record<string, unknown> & { id: string };

export function CoursesPage() {
  const { role, uid, profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const manage = can(role, 'lms.manage');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const [enrol, setEnrol] = useState<WithId<Course> | null>(null);
  const [classId, setClassId] = useState('');
  const config: CrudConfig<WithId<Course> & Row> = {
    collection: C.courses, singular: 'Course', plural: 'Courses', description: 'Create courses, build modules and lessons, publish and enrol learners.', auditActions: true, canCreate: manage, canEdit: manage, canDelete: manage, dialogSize: 'lg',
    rowFilter: (r) => (role === 'teacher' ? r.instructorUid === uid : true),
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true, span: 2 }, { name: 'category', label: 'Category', type: 'text', required: true, placeholder: 'Mathematics, ICT, Islamic Studies…' },
      { name: 'level', label: 'Level', type: 'text', placeholder: 'JSS 1, Beginner…' }, { name: 'durationHours', label: 'Duration (hours)', type: 'number', min: 0 },
      { name: 'visibility', label: 'Visibility', type: 'select', required: true, defaultValue: 'students', options: [{ value: 'public', label: 'Public (listed on website)' }, { value: 'students', label: 'All signed-in learners' }, { value: 'restricted', label: 'Restricted — enrolled learners only' }] },
      { name: 'enrollmentMode', label: 'Enrolment', type: 'select', required: true, defaultValue: 'open', options: [{ value: 'open', label: 'Learners can self-enrol' }, { value: 'assigned', label: 'Staff enrol learners' }] },
      { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
      { name: 'description', label: 'Description', type: 'textarea', required: true }, { name: 'thumbnail', label: 'Thumbnail', type: 'image' },
    ],
    beforeSave: (p, e) => (e ? { ...p, slug: slugify(String(p.title)) } : { ...p, slug: slugify(String(p.title)), instructorUid: uid ?? '', instructorName: profile?.displayName ?? '' }),
    columns: [
      { key: 't', header: 'Course', primary: true, cell: (r) => <div><p className="font-medium">{r.title}</p><p className="text-xs text-muted">{r.category} · {r.instructorName}</p></div> },
      { key: 'v', header: 'Visibility', cell: (r) => r.visibility }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    ],
    searchKeys: ['title', 'category', 'instructorName'], filters: [{ name: 'status', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] }],
    rowActions: (r) => (manage ? <>
      <Button size="sm" variant="outline" onClick={() => nav(`/app/lms/courses/${r.id}/build`)}><Pencil className="h-4 w-4" /> Build</Button>
      <Button size="icon" variant="ghost" aria-label="Enrol a class" onClick={() => { setEnrol(r); setClassId(''); }}><Users className="h-4 w-4" /></Button></> : null),
  };
  return (
    <>
      <CrudPage config={config} />
      <Dialog open={!!enrol} onClose={() => setEnrol(null)} title="Enrol a class" description={enrol?.title} size="sm" footer={<><Button variant="outline" onClick={() => setEnrol(null)}>Cancel</Button><Button disabled={!classId} onClick={() => { void enrolClass(enrol!, classId).then((n) => { toast.success(`${n} learner(s) enrolled`); setEnrol(null); }).catch((e) => toast.error(errorMessage(e))); }}>Enrol</Button></>}>
        <Field label="Class">{(a) => <Select {...a} value={classId} onChange={(e) => setClassId(e.target.value)}><option value="">Select…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        <p className="mt-2 text-xs text-muted">Only learners with portal logins are enrolled.</p>
      </Dialog>
    </>
  );
}

export function CourseBuilder() {
  const { id = '' } = useParams();
  const { uid: myUid, roles } = useAuth();
  const toast = useToast();
  const seesAllStudio = roles.some((r) => ['super_admin', 'principal', 'admin', 'director'].includes(r));
  const studioConstraints = seesAllStudio ? [] : [where('teacherUids', 'array-contains', myUid ?? '')];
  const course = useDocument<Course>(C.courses, id);
  const mods = useCollection<CourseModule>(C.modules, () => [where('courseId', '==', id)], id);
  const lessons = useCollection<Lesson>(C.lessons, () => [where('courseId', '==', id)], id);
  const [modDlg, setModDlg] = useState<Partial<WithId<CourseModule>> | null>(null);
  const [lesDlg, setLesDlg] = useState<(Partial<WithId<Lesson>> & { moduleId: string }) | null>(null);
  const [del, setDel] = useState<{ kind: 'module' | 'lesson'; id: string } | null>(null);
  /** Copies the Lesson Studio lesson's current learner-facing text into this course item. */
  const resync = async (l: WithId<Lesson>) => {
    try {
      const plan = l.studioId ? await getById<LessonPlan>(C.lessonPlans, l.studioId) : null;
      if (!plan) throw new Error('That Lesson Studio lesson could not be found or opened.');
      await patchDoc(C.lessons, l.id, { content: studioToHtml(plan), studioTitle: plan.title, studioVersion: plan.version ?? 1, studioSyncedAt: new Date() });
      toast.success('Lesson updated from the Studio');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  if (course.loading) return <Spinner />;
  if (!course.data) return <EmptyState title="Course not found" />;
  const sortedMods = [...mods.data].sort((a, b) => a.order - b.order);
  return (
    <>
      <PageHeader title={course.data.title} description="Modules and lessons. Lessons are shown to learners in this order." actions={<><Link to="/app/lms/courses"><Button variant="outline">← Courses</Button></Link><Button onClick={() => setModDlg({ order: sortedMods.length + 1 })}><Plus className="h-4 w-4" /> Module</Button></>} />
      {sortedMods.length === 0 ? <Card><EmptyState title="No modules yet" description="Add a module, then add lessons to it." /></Card> : (
        <div className="space-y-4">{sortedMods.map((m) => {
          const ls = lessons.data.filter((l) => l.moduleId === m.id).sort((a, b) => a.order - b.order);
          return (<Card key={m.id}><CardHeader title={`${m.order}. ${m.title}`} action={<div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setLesDlg({ moduleId: m.id, order: ls.length + 1, type: 'text' })}><Plus className="h-4 w-4" /> Lesson</Button><Button size="icon" variant="ghost" aria-label="Edit module" onClick={() => setModDlg(m)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Delete module" onClick={() => setDel({ kind: 'module', id: m.id })}><Trash2 className="h-4 w-4 text-danger" /></Button></div>} />
            <ul className="divide-y divide-line">{ls.length === 0 && <li className="px-5 py-4 text-sm text-muted">No lessons yet.</li>}{ls.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3"><span className="flex items-center gap-2 text-sm"><FileText className="h-4 w-4 text-gold-500" />{l.order}. {l.title} <Badge>{ITEM_LABEL[l.type] ?? l.type}</Badge>{l.preview && <Badge tone="gold">preview</Badge>}</span>
                <span className="flex">{l.type === 'studio' && <Button size="icon" variant="ghost" aria-label="Update from Lesson Studio" title="Update from Lesson Studio" onClick={() => void resync(l)}><RefreshCw className="h-4 w-4" /></Button>}<Button size="icon" variant="ghost" aria-label="Edit lesson" onClick={() => setLesDlg(l)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="Delete lesson" onClick={() => setDel({ kind: 'lesson', id: l.id })}><Trash2 className="h-4 w-4 text-danger" /></Button></span></li>))}</ul></Card>);
        })}</div>)}
      <Dialog open={!!modDlg} onClose={() => setModDlg(null)} title={modDlg?.id ? 'Edit module' : 'New module'} size="sm">
        {modDlg && <EntityForm key={modDlg.id ?? 'n'} initial={modDlg.id ? (modDlg as Record<string, unknown>) : null} fields={[{ name: 'title', label: 'Title', type: 'text', required: true }, { name: 'order', label: 'Order', type: 'number', required: true, min: 1, defaultValue: modDlg.order }]}
          onSubmit={async (p) => { try { if (modDlg.id) await patchDoc(C.modules, modDlg.id, p); else await createDoc(C.modules, { ...p, courseId: id }); setModDlg(null); toast.success('Saved'); } catch (e) { toast.error(errorMessage(e)); } }} />}
      </Dialog>
      <Dialog open={!!lesDlg} onClose={() => setLesDlg(null)} title={lesDlg?.id ? 'Edit lesson' : 'New lesson'} size="xl">
        {lesDlg && <EntityForm key={lesDlg.id ?? 'n'} initial={lesDlg.id ? ({ ...lesDlg, attachmentsText: (lesDlg.attachments ?? []).map((a) => `${a.name} | ${a.url}`) } as Record<string, unknown>) : null} fields={[
          { name: 'title', label: 'Title', type: 'text', required: true, span: 2 }, { name: 'type', label: 'Type', type: 'select', required: true, defaultValue: lesDlg.type ?? 'text', options: [{ value: 'text', label: 'Text lesson' }, { value: 'video', label: 'Video lesson' }, { value: 'pdf', label: 'PDF resource' }, { value: 'presentation', label: 'Presentation (library file or Google Slides)' }, { value: 'file', label: 'Downloadable material' }, { value: 'studio', label: 'Lesson from the Lesson Studio' }, { value: 'quiz', label: 'Quiz (from this course’s quizzes)' }, { value: 'assignment', label: 'Assignment (from this course’s assignments)' }] },
          { name: 'order', label: 'Order', type: 'number', required: true, min: 1, defaultValue: lesDlg.order }, { name: 'durationMin', label: 'Minutes', type: 'number', min: 0 }, { name: 'preview', label: 'Free preview (visible without enrolling)', type: 'checkbox' },
          { name: 'videoUrl', label: 'Video URL (YouTube / Vimeo / Google Drive / direct .mp4)', type: 'url' },
          { name: 'completionRule', label: 'Video completion', type: 'select', defaultValue: 'manual', options: [{ value: 'manual', label: 'Learner confirms “Mark complete”' }, { value: 'watch', label: 'Needs 90% tracked playback (direct .mp4/.webm only)' }] },
          { name: 'resourceId', label: 'Presentation from the Resources library', type: 'ref', ref: { collection: C.resources, label: (r) => String(r.title), labelField: 'resourceTitle', filter: (r) => r.fileKind === 'document' }, hint: 'Upload PDFs / slides in Resources first, publish them for students.' },
          { name: 'slidesUrl', label: 'or Google Slides link', type: 'url', hint: 'Share the deck as “anyone with the link can view”.' }, { name: 'fileUrl', label: 'PDF / file URL', type: 'url', hint: 'Upload in CMS → Media or paste a link.' },
          { name: 'studioId', label: 'Lesson Studio lesson (type: Lesson Studio)', type: 'ref', ref: { collection: C.lessonPlans, label: (r) => String(r.title), labelField: 'studioTitle', filter: (r) => r.status === 'published' || r.status === 'approved', constraints: studioConstraints, constraintsKey: seesAllStudio ? 'all' : `mine:${myUid ?? ''}` }, hint: 'Approved or published lessons only (teachers see their own). Learners see a copy without the teacher guide. Use the refresh button to pull later edits.' },
          { name: 'quizId', label: 'Quiz (type: Quiz)', type: 'ref', ref: { collection: C.quizzes, label: (r) => String(r.title), labelField: 'quizTitle', filter: (r) => r.courseId === id }, hint: 'Create the quiz under Quizzes and choose this course first.' },
          { name: 'assignmentId', label: 'Assignment (type: Assignment)', type: 'ref', ref: { collection: C.assignments, label: (r) => String(r.title), labelField: 'assignmentTitle', filter: (r) => r.courseId === id }, hint: 'Create the assignment under Assignments and choose this course first.' },
          { name: 'content', label: 'Lesson text', type: 'richtext', hint: 'Maths: type $x^2 + 1$ for a formula in the line, or $$\\frac{a}{b}$$ on its own line.' }, { name: 'attachmentsText', label: 'Attachments', type: 'list', hint: 'One per line:  Name | https://…' }]}
          onSubmit={async (p) => {
            try {
              const attachments = ((p.attachmentsText as string[]) ?? []).map((l) => { const [name, url] = l.split('|').map((s) => s.trim()); return { name: name ?? 'File', url: url ?? '' }; }).filter((a) => /^https?:/.test(a.url));
              const { attachmentsText, ...rest } = p; void attachmentsText;
              const data: Record<string, unknown> = { ...rest, attachments, moduleId: lesDlg.moduleId, courseId: id };
              const bad = itemProblem({ type: data.type as Lesson['type'], studioId: data.studioId as string | undefined, quizId: data.quizId as string | undefined, assignmentId: data.assignmentId as string | undefined });
              if (bad) throw new Error(bad);
              if (data.type === 'studio') {
                const plan = await getById<LessonPlan>(C.lessonPlans, String(data.studioId));
                if (!plan) throw new Error('That Lesson Studio lesson could not be found or opened.');
                data.content = studioToHtml(plan); data.studioTitle = plan.title; data.studioVersion = plan.version ?? 1; data.studioSyncedAt = new Date();
                if (!data.durationMin && plan.durationMin) data.durationMin = plan.durationMin;
              }
              if (lesDlg.id) await patchDoc(C.lessons, lesDlg.id, data); else await createDoc(C.lessons, data);
              setLesDlg(null); toast.success('Lesson saved');
            } catch (e) { toast.error(errorMessage(e)); }
          }} />}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title={`Delete ${del?.kind}?`} message={del?.kind === 'module' ? 'Lessons inside it will also be deleted.' : 'This cannot be undone.'} onConfirm={async () => {
        if (!del) return;
        try { if (del.kind === 'module') { for (const l of lessons.data.filter((x) => x.moduleId === del.id)) await removeDoc(C.lessons, l.id); await removeDoc(C.modules, del.id); } else await removeDoc(C.lessons, del.id); toast.success('Deleted'); } catch (e) { toast.error(errorMessage(e)); }
        setDel(null);
      }} />
    </>
  );
}

/* ------------------------------------------------------- student side */
export function CataloguePage() {
  const { uid, profile } = useAuth();
  const toast = useToast();
  const students = useCollection<Student>(C.students, () => (uid ? [where('studentUid', '==', uid)] : null), uid ?? '');
  const a = useCollection<Course>(C.courses, () => [where('visibility', '==', 'students'), where('status', '==', 'published')], 's');
  const b = useCollection<Course>(C.courses, () => [where('visibility', '==', 'public'), where('status', '==', 'published')], 'p');
  const mine = useCollection<CourseEnrollment>(C.courseEnrollments, () => (uid ? [where('uid', '==', uid)] : null), uid ?? '');
  const courses = [...a.data, ...b.data];
  const take = async (c: WithId<Course>) => {
    if (!uid || !profile) return;
    try { const s = students.data[0]; await enrolStudent(c, { uid, name: profile.displayName, studentId: s?.id, parentUids: s?.parentUids }); toast.success(`Enrolled in ${c.title}`); } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <>
      <PageHeader title="Course catalogue" description="Browse published courses and enrol." />
      {a.loading || b.loading ? <Spinner /> : courses.length === 0 ? <Card><EmptyState title="No courses published yet" /></Card> : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{courses.map((c) => { const en = mine.data.some((m) => m.courseId === c.id); return (
          <Card key={c.id} className="flex flex-col overflow-hidden">{c.thumbnail && <img src={c.thumbnail} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />}
            <div className="flex flex-1 flex-col p-5"><p className="text-xs uppercase tracking-wide text-gold-600">{c.category}</p><h3 className="mt-1 text-[15px] font-semibold">{c.title}</h3><p className="mt-1 flex-1 text-sm text-muted line-clamp-3">{c.description}</p>
              <div className="mt-4">{en ? <Link to={`/app/lms/course/${c.id}`}><Button variant="outline" className="w-full">Continue</Button></Link> : c.enrollmentMode === 'open' ? <Button className="w-full" onClick={() => void take(c)}>Enrol</Button> : <Badge>Enrolment by school</Badge>}</div></div></Card>); })}</div>)}
    </>
  );
}

export function MyCoursesPage() {
  const { uid } = useAuth();
  const { data, loading } = useCollection<CourseEnrollment>(C.courseEnrollments, () => (uid ? [where('uid', '==', uid)] : null), uid ?? '');
  return (
    <>
      <PageHeader title="My learning" actions={<Link to="/app/lms/catalogue"><Button variant="outline">Browse catalogue</Button></Link>} />
      {loading ? <Spinner /> : data.length === 0 ? <Card><EmptyState title="You are not enrolled in any course" action={<Link to="/app/lms/catalogue"><Button>Browse courses</Button></Link>} /></Card> : (
        <div className="grid gap-4 md:grid-cols-2">{data.map((e) => (
          <Link key={e.id} to={`/app/lms/course/${e.courseId}`}><Card className="p-5 transition-shadow hover:shadow-pop"><div className="flex items-start justify-between gap-3"><h3 className="font-semibold">{e.courseTitle}</h3><StatusBadge status={e.status} /></div>
            <Progress className="mt-4" value={e.progressPct} /><p className="mt-2 text-xs text-muted">{e.completedLessons} of {e.totalLessons ?? '?'} lessons · {e.progressPct}%</p></Card></Link>))}</div>)}
    </>
  );
}

export function CoursePlayer() {
  const { id = '' } = useParams();
  const { uid, role } = useAuth();
  const toast = useToast();
  const course = useDocument<Course>(C.courses, id);
  const mods = useCollection<CourseModule>(C.modules, () => [where('courseId', '==', id)], id);
  const lessons = useCollection<Lesson>(C.lessons, () => [where('courseId', '==', id)], id);
  const prog = useCollection<{ lessonId: string }>(C.lessonProgress, () => (uid ? [where('uid', '==', uid), where('courseId', '==', id)] : null), `${uid}${id}`);
  const enr = useDocument<CourseEnrollment>(C.courseEnrollments, uid ? `${id}_${uid}` : null);
  const quizzes = useCollection<Row>(C.quizzes, () => [where('courseId', '==', id)], id);
  const [cur, setCur] = useState('');
  const [quiz, setQuiz] = useState<Row | null>(null);
  const act = useDocument<LessonActivity>(C.lessonActivity, role === 'student' && uid && cur ? `${uid}_${cur}` : null);
  const viewedRef = useRef('');
  const ordered = useMemo(() => [...mods.data].sort((a, b) => a.order - b.order).flatMap((m) => lessons.data.filter((l) => l.moduleId === m.id).sort((a, b) => a.order - b.order)), [mods.data, lessons.data]);
  useEffect(() => { if (!cur && ordered[0]) setCur(ordered[0].id); }, [ordered, cur]);
  const curLesson = ordered.find((l) => l.id === cur);
  // quiz / assignment items complete themselves once the learner has handed something in
  const qAttempt = useDocument<{ score?: number }>(C.quizAttempts, role === 'student' && uid && curLesson?.type === 'quiz' && curLesson.quizId ? `${curLesson.quizId}_${uid}` : null);
  const aSub = useDocument<{ status?: string }>(C.submissions, role === 'student' && uid && curLesson?.type === 'assignment' && curLesson.assignmentId ? `${curLesson.assignmentId}_${uid}` : null);
  const handedIn = (curLesson?.type === 'quiz' && qAttempt.data?.score != null) || (curLesson?.type === 'assignment' && !!aSub.data);
  const alreadyDone = !!curLesson && prog.data.some((p) => p.lessonId === curLesson.id);
  useEffect(() => {
    if (role !== 'student' || !uid || !curLesson || !enr.data || !completesOnSubmit(curLesson.type) || !handedIn || alreadyDone) return;
    void setLessonComplete({ uid, courseId: id, lessonId: curLesson.id, complete: true, totalLessons: ordered.length }).catch(() => undefined);
  }, [role, uid, curLesson, enr.data, handedIn, alreadyDone, id, ordered.length]);
  const enrParents = enr.data?.parentUids;
  useEffect(() => {
    // opening a lesson is recorded as "viewed" (never as complete); video lessons record their own progress
    if (role !== 'student' || !uid || !curLesson || !enrParents || curLesson.type === 'video' || act.loading || act.data || viewedRef.current === curLesson.id) return;
    viewedRef.current = curLesson.id;
    void saveActivity({ uid, courseId: id, lessonId: curLesson.id, parentUids: enrParents, ranges: [], watchedPct: 0 }).catch(() => undefined);
  }, [role, uid, curLesson, enrParents, act.loading, act.data, id]);
  if (course.loading || lessons.loading) return <Spinner />;
  if (!course.data) return <EmptyState title="Course unavailable" description="It may be unpublished or you may not be enrolled." />;
  const lesson = ordered.find((l) => l.id === cur);
  const done = new Set(prog.data.map((p) => p.lessonId));
  const student = role === 'student';
  const parsedVid = lesson?.type === 'video' && lesson.videoUrl ? parseVideoUrl(lesson.videoUrl) : null;
  const trackable = isTrackable(parsedVid?.provider);
  const parents = enr.data?.parentUids ?? [];
  const record = (s: { ranges: [number, number][]; pct: number; positionSec: number; durationSec: number }) => {
    if (!student || !uid || !lesson || !enr.data) return;
    void saveActivity({ uid, courseId: id, lessonId: lesson.id, parentUids: parents, ranges: s.ranges, watchedPct: s.pct, positionSec: s.positionSec, durationSec: s.durationSec }).catch(() => undefined);
  };
  const toggle = async () => { if (!lesson || !uid) return; if (!done.has(lesson.id)) { const ok = canComplete(lesson.completionRule, { trackable: trackable && lesson.type === 'video', watchedPct: act.data?.watchedPct ?? 0 }); if (!ok.ok) { toast.error(ok.reason ?? 'Finish the lesson first.'); return; } } try { await setLessonComplete({ uid, courseId: id, lessonId: lesson.id, complete: !done.has(lesson.id), totalLessons: ordered.length }); } catch (e) { toast.error(errorMessage(e)); } };
  const idx = ordered.findIndex((l) => l.id === cur);
  return (
    <>
      <PageHeader title={course.data.title} description={course.data.description} actions={enr.data && <div className="w-44"><Progress value={enr.data.progressPct} /><p className="mt-1 text-right text-xs text-muted">{enr.data.progressPct}% complete</p></div>} />
      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit"><CardHeader title="Lessons" /><div className="max-h-[60vh] overflow-y-auto">{[...mods.data].sort((a, b) => a.order - b.order).map((m) => (
          <div key={m.id}><p className="bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">{m.title}</p><ul>{lessons.data.filter((l) => l.moduleId === m.id).sort((a, b) => a.order - b.order).map((l) => (
            <li key={l.id}><button onClick={() => setCur(l.id)} className={`flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-cream ${cur === l.id ? 'bg-forest-50 font-medium text-forest-700' : ''}`}>{done.has(l.id) ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ok" /> : <Circle className="h-4 w-4 shrink-0 text-line" />}{l.title}</button></li>))}</ul></div>))}
          {quizzes.data.length > 0 && <div><p className="bg-cream px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Quizzes</p>{quizzes.data.map((q) => <button key={q.id} onClick={() => setQuiz(q)} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-cream">{String(q.title)}</button>)}</div>}</div></Card>
        <Card>{!lesson ? <EmptyState title="No lessons yet" description="This course has no lessons you can open." /> : (
          <CardBody className="space-y-5"><h2 className="text-xl font-semibold">{lesson.title}</h2>
            {lesson.type === 'video' && lesson.videoUrl && <VideoPlayer key={lesson.id} url={lesson.videoUrl} title={lesson.title} saved={act.data ? { ranges: act.data.ranges, positionSec: act.data.positionSec } : undefined} onProgress={record} />}
            {lesson.type === 'pdf' && lesson.fileUrl && <PresentationViewer url={lesson.fileUrl} title={lesson.title} />}
            {lesson.type === 'presentation' && (lesson.resourceId ? <ResourceViewer resourceId={lesson.resourceId} fallbackTitle={lesson.title} /> : lesson.slidesUrl && googleSlidesEmbed(lesson.slidesUrl) ? <PresentationViewer url={lesson.slidesUrl} title={lesson.title} /> : <p className="text-sm text-muted">No presentation has been attached to this lesson yet.</p>)}
            {lesson.type === 'quiz' && (lesson.quizId ? <QuizEmbed key={lesson.id} quizId={lesson.quizId} /> : <p className="text-sm text-muted">No quiz has been attached to this item yet.</p>)}
            {lesson.type === 'assignment' && (lesson.assignmentId ? <AssignmentEmbed key={lesson.id} assignmentId={lesson.assignmentId} /> : <p className="text-sm text-muted">No assignment has been attached to this item yet.</p>)}
            {lesson.type === 'studio' && lesson.studioSyncedAt != null && <p className="text-xs text-muted">From the Lesson Studio{lesson.studioTitle ? `: ${lesson.studioTitle}` : ''}</p>}
            {lesson.type === 'file' && lesson.fileUrl && <a href={lesson.fileUrl} target="_blank" rel="noopener noreferrer"><Button variant="outline">Download material</Button></a>}
            {lesson.content && (/<\/?[a-z][\s\S]*>/i.test(lesson.content) ? <Rich html={lesson.content} /> : <pre className="whitespace-pre-wrap font-sans text-[15px] leading-7">{lesson.content}</pre>)}
            {(lesson.attachments ?? []).length > 0 && <div><p className="mb-2 text-sm font-medium">Attachments</p><ul className="space-y-1">{lesson.attachments!.map((a) => <li key={a.url}><a className="text-sm text-forest-500 underline" href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a></li>)}</ul></div>}
            <div className="flex flex-wrap justify-between gap-2 border-t border-line pt-4"><Button variant="outline" disabled={idx <= 0} onClick={() => setCur(ordered[idx - 1]!.id)}>Previous</Button>
              {student && enr.data && !completesOnSubmit(lesson.type) && <Button variant={done.has(lesson.id) ? 'outline' : 'gold'} onClick={() => void toggle()}>{done.has(lesson.id) ? 'Mark as not complete' : 'Mark complete'}</Button>}
              {student && enr.data && !done.has(lesson.id) && lesson.completionRule === 'watch' && trackable && <p className="basis-full text-xs text-muted">This lesson is completed after you watch 90% of the video (watched so far: {act.data?.watchedPct ?? 0}%).</p>}
              <Button disabled={idx >= ordered.length - 1} onClick={() => setCur(ordered[idx + 1]!.id)}>Next</Button></div></CardBody>)}</Card>
      </div>
      {quiz && <QuizTake quiz={quiz} onClose={() => setQuiz(null)} />}
    </>
  );
}

