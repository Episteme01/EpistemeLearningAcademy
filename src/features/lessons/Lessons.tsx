import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { serverTimestamp, where } from 'firebase/firestore';
import { Download, Eye, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { EmptyState, Spinner, StatusBadge, Tabs } from '@/components/ui/data';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { useAuth } from '@/features/auth/AuthContext';
import { useSite } from '@/features/public/PublicLayout';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { allowedTransitions, canEditContent, chooseDraft, GUIDE_SECTIONS, isDirty, lessonToHtml, RICH_SECTIONS, STATUS_LABEL, submitProblems, wordCount, type LessonStatus } from '@/lib/lessons';
import { sanitizeHtml } from '@/lib/sanitize';
import { downloadText, errorMessage, toDate } from '@/lib/utils';
import { audit } from '@/services/audit';
import { batchSet, createDoc, patchDoc, removeDoc } from '@/services/db';
import type { LessonGuide, LessonPlan } from '@/types/models';

const isLeaderRole = (roles: string[]) => roles.some((r) => ['super_admin', 'principal', 'admin'].includes(r));
const DRAFT_KEY = (id: string) => `ela-lesson-draft-${id}`;

/** Fields the author edits in the studio (everything else is set when the lesson is created). */
const FIELDS = ['title', 'durationMin', 'week', 'objectives', 'materials', 'references', 'supplementary', ...RICH_SECTIONS.map(([k]) => k)] as const;
type Form = Record<string, unknown>;
const pick = (d: Record<string, unknown>): Form => { const o: Form = {}; for (const k of FIELDS) o[k] = d[k] ?? (['objectives', 'materials', 'references', 'supplementary'].includes(k) ? [] : ''); return o; };
const guideOf = (g: Record<string, unknown> | null | undefined): Record<string, string> => { const o: Record<string, string> = {}; for (const [k] of GUIDE_SECTIONS) o[k] = String(g?.[k] ?? ''); return o; };

/* ------------------------------------------------------------------ list */
export function LessonList() {
  const { roles, uid, profile } = useAuth();
  const nav = useNavigate(); const toast = useToast();
  const leader = isLeaderRole(roles);
  const isStudent = roles.includes('student') && !leader && !roles.includes('teacher');
  const canWrite = leader || roles.includes('teacher');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const q = useCollection<LessonPlan>(C.lessonPlans, () => {
    if (leader || roles.includes('director')) return [];
    if (isStudent) return profile?.classId ? [where('status', '==', 'published'), where('classId', '==', profile.classId)] : null;
    return uid ? [where('teacherUids', 'array-contains', uid)] : null;
  }, `${uid}|${roles.join()}|${profile?.classId ?? ''}`);
  const rows = useMemo(() => q.data.filter((r) => !status || r.status === status).sort((a, b) => (toDate(b.updatedAt)?.getTime() ?? 0) - (toDate(a.updatedAt)?.getTime() ?? 0)), [q.data, status]);
  return (
    <div>
      <PageHeader title="Lessons" description={isStudent ? 'Lessons your teachers have published for your class.' : 'Write lessons from your curriculum, send them for review, and publish approved lessons to learners.'}
        actions={canWrite ? <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New lesson</Button> : undefined} />
      {!isStudent && (
        <div className="mb-3 max-w-xs">
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      )}
      {q.loading ? <Spinner /> : q.error ? <p className="text-sm text-danger">{q.error}</p> : rows.length === 0 ? <EmptyState title="No lessons yet" description={canWrite ? 'Choose “New lesson” to write your first one.' : 'Nothing has been published for your class yet.'} /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id}><CardBody>
              <div className="flex items-start justify-between gap-2">
                <Link to={`/app/lms/lessons/${r.id}`} className="font-medium text-forest-600 hover:underline">{r.title || 'Untitled lesson'}</Link>
                <StatusBadge status={r.status} />
              </div>
              <p className="mt-1 text-sm text-muted">{[r.className, r.subjectName, r.week ? `Week ${r.week}` : ''].filter(Boolean).join(' · ')}</p>
              {!isStudent && r.authorName && <p className="text-xs text-muted">By {r.authorName}</p>}
            </CardBody></Card>
          ))}
        </div>
      )}
      {open && <NewLesson onClose={() => setOpen(false)} onCreated={(id) => { toast.success('Lesson created as a draft.'); nav(`/app/lms/lessons/${id}`); }} />}
    </div>
  );
}

function NewLesson({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { uid, profile } = useAuth(); const toast = useToast();
  const [cid, setCid] = useState(''); const [topicId, setTopicId] = useState(''); const [subId, setSubId] = useState('');
  const [week, setWeek] = useState(''); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false);
  const curricula = useCollection<Record<string, unknown>>(C.curricula, () => []);
  const topics = useCollection<{ title: string; parentId: string; order: number; durationMin?: number }>(C.curriculumTopics, () => (cid ? [where('curriculumId', '==', cid)] : null), cid);
  const cur = curricula.data.find((c) => c.id === cid);
  const mains = topics.data.filter((t) => !t.parentId).sort((a, b) => a.order - b.order);
  const subs = topics.data.filter((t) => t.parentId === topicId).sort((a, b) => a.order - b.order);
  const create = async () => {
    if (!uid || !cur) return;
    if (!title.trim()) { toast.error('Give the lesson a title.'); return; }
    setBusy(true);
    try {
      const teachers = Array.from(new Set([...(((cur.teacherUids as string[] | undefined) ?? [])), uid]));
      const topic = topics.data.find((t) => t.id === (subId || topicId));
      const wk = parseInt(week, 10);
      const id = await createDoc(C.lessonPlans, {
        title: title.trim(), status: 'draft', curriculumId: cid, topicId: topicId || undefined, subtopicId: subId || undefined,
        week: wk >= 1 && wk <= 20 ? wk : undefined, termId: cur.termId || undefined,
        subjectId: cur.subjectId, subjectName: cur.subjectName, classId: cur.classId || undefined, className: cur.className || undefined,
        durationMin: topic?.durationMin || (cur.lessonDurationMin as number | undefined) || 40,
        objectives: (cur.objectives as string[] | undefined)?.slice(0, 3) ?? [],
        authorUid: uid, authorName: profile?.displayName ?? '', teacherUids: teachers, version: 1,
      });
      void audit('lesson.create', `lessonPlans/${id}`, title.trim());
      onCreated(id);
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="New lesson" description="Pick where it sits in the curriculum. You can change the wording later." footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={() => void create()} disabled={busy || !cid}>Create draft</Button></>}>
      <div className="space-y-3">
        <Field label="Curriculum" required>{(p) => <Select {...p} value={cid} onChange={(e) => { setCid(e.target.value); setTopicId(''); setSubId(''); }}><option value="">Choose…</option>{curricula.data.filter((c) => c.status !== 'archived').map((c) => <option key={c.id} value={c.id}>{String(c.title)}</option>)}</Select>}</Field>
        {cid && <Field label="Topic">{(p) => <Select {...p} value={topicId} onChange={(e) => { setTopicId(e.target.value); setSubId(''); const t = mains.find((m) => m.id === e.target.value); if (t && !title) setTitle(t.title); }}><option value="">(not linked)</option>{mains.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>}
        {topicId && subs.length > 0 && <Field label="Subtopic">{(p) => <Select {...p} value={subId} onChange={(e) => { setSubId(e.target.value); const t = subs.find((m) => m.id === e.target.value); if (t) setTitle(t.title); }}><option value="">(whole topic)</option>{subs.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>}
        <Field label="Week (1–20)">{(p) => <Input {...p} type="number" min={1} max={20} value={week} onChange={(e) => setWeek(e.target.value)} />}</Field>
        <Field label="Lesson title" required>{(p) => <Input {...p} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- lesson page */
type Tab = 'lesson' | 'guide' | 'resources' | 'workflow';
export function LessonPage() {
  const { id } = useParams();
  const { roles, uid } = useAuth(); const toast = useToast(); const nav = useNavigate(); const site = useSite();
  const leader = isLeaderRole(roles);
  const lessonQ = useDocument<LessonPlan>(C.lessonPlans, id);
  const l = lessonQ.data;
  const staff = leader || roles.includes('teacher') || roles.includes('director');
  const guideQ = useDocument<LessonGuide>(C.lessonGuides, staff ? id : null);
  const author = !!l && !!uid && (l.teacherUids ?? []).includes(uid);
  const perms = { leader, author };
  const editable = !!l && canEditContent(l.status, perms);

  const [form, setForm] = useState<Form | null>(null);
  const [guide, setGuide] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState<Form | null>(null); const [savedGuide, setSavedGuide] = useState<Record<string, string> | null>(null);
  const [tab, setTab] = useState<Tab>('lesson'); const [saving, setSaving] = useState(false); const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [restore, setRestore] = useState<{ form: Form; guide: Record<string, string> | null } | null>(null);
  const [note, setNote] = useState('');

  // Initialise once when the lesson first arrives (later server updates must not overwrite typing).
  useEffect(() => {
    if (!l || form) return;
    const remote = pick(l as unknown as Record<string, unknown>);
    setForm(remote); setSaved(remote);
    if (editable) {
      try {
        const raw = localStorage.getItem(DRAFT_KEY(l.id));
        if (raw) {
          const loc = JSON.parse(raw) as { savedAt: number; data: Form; guide?: Record<string, string> | null };
          if (chooseDraft({ savedAt: loc.savedAt, data: loc.data }, toDate(l.updatedAt)?.getTime() ?? 0, remote) === 'local') setRestore({ form: loc.data, guide: loc.guide ?? null });
          else localStorage.removeItem(DRAFT_KEY(l.id));
        }
      } catch { /* storage unavailable: autosave to the cloud still works */ }
    }
  }, [l, form, editable]);
  useEffect(() => {
    if (!staff || guide || lessonQ.loading || guideQ.loading) return;
    const g = guideOf(guideQ.data as unknown as Record<string, unknown> | null);
    setGuide(g); setSavedGuide(g);
  }, [staff, guide, guideQ.data, guideQ.loading, lessonQ.loading]);

  const dirty = !!form && !!saved && isDirty(form, saved);
  const guideDirty = !!guide && !!savedGuide && isDirty(guide, savedGuide);
  const anyDirty = dirty || guideDirty;

  // local autosave (every change, debounced) so a closed tab or lost signal never loses work
  useEffect(() => {
    if (!l || !form || !editable || !anyDirty) return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY(l.id), JSON.stringify({ savedAt: Date.now(), data: form, guide })); } catch { /* ignore */ } }, 1500);
    return () => clearTimeout(t);
  }, [l, form, guide, editable, anyDirty]);
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [anyDirty]);

  const save = useCallback(async (quiet = false) => {
    if (!l || !form || saving) return false;
    if (!dirty && !guideDirty) return true;
    setSaving(true);
    try {
      const data: Form = { ...form, objectives: (form.objectives as string[]).filter((x) => x.trim()), supplementary: (form.supplementary as { title: string; url: string }[]).filter((s) => (s.title.trim() || s.url.trim()) && (!s.url.trim() || /^https?:\/\//i.test(s.url.trim()))) };
      if (dirty) await patchDoc(C.lessonPlans, l.id, { ...data, version: (l.version ?? 1) + 1 });
      if (guideDirty && guide) await batchSet([{ col: C.lessonGuides, id: l.id, data: guide }]);
      setSaved(form); setSavedGuide(guide); setLastSaved(new Date());
      try { localStorage.removeItem(DRAFT_KEY(l.id)); } catch { /* ignore */ }
      if (!quiet) toast.success('Saved.');
      return true;
    } catch (e) { toast.error(errorMessage(e)); return false; } finally { setSaving(false); }
  }, [l, form, guide, dirty, guideDirty, saving, toast]);
  const saveRef = useRef(save); saveRef.current = save;
  useEffect(() => { if (!editable) return; const t = setInterval(() => { void saveRef.current(true); }, 45000); return () => clearInterval(t); }, [editable]);
  // the interval only fires when something changed, because save() with nothing dirty writes nothing
  const set = (k: string, v: unknown) => setForm((f) => ({ ...(f ?? {}), [k]: v }));

  if (lessonQ.loading) return <Spinner />;
  if (!l || !form) return <EmptyState title="Lesson not found" description="It may have been deleted, or it is not published for your class." action={<Link to="/app/lms/lessons"><Button>Back to lessons</Button></Link>} />;

  const next = allowedTransitions(l.status, perms);
  const view = { ...(l as unknown as Record<string, unknown>), ...form } as never;
  const metaFor = () => ({ school: site.name, className: l.className ?? '', subjectName: l.subjectName ?? '', teacherName: l.authorName ?? '', topic: l.title, week: (form.week as number) || l.week });
  const printIt = (withGuide: boolean) => {
    const w = window.open('', '_blank'); if (!w) { toast.error('Allow pop-ups to print.'); return; }
    w.document.write(lessonToHtml(view, metaFor(), sanitizeHtml, withGuide && staff ? guide : null)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  };
  const download = () => downloadText(`lesson-${l.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.html`, lessonToHtml(view, metaFor(), sanitizeHtml, null), 'text/html');

  const move = async (to: LessonStatus) => {
    if (to === 'review') {
      const problems = submitProblems({ ...(view as object), status: l.status, subjectId: l.subjectId } as never);
      if (problems.length) { toast.error(problems[0] ?? 'Complete the lesson first.'); return; }
    }
    if (anyDirty && editable && !(await save(true))) return;
    try {
      const extra: Record<string, unknown> = { status: to };
      if (to === 'draft' && leader) extra.reviewNote = note.trim();
      if (to === 'approved') { extra.approvedBy = uid; extra.reviewNote = note.trim(); }
      if (to === 'published') extra.publishedAt = serverTimestamp();
      // an author withdrawing a lesson from review may only change status (enforced by the security rules)
      await patchDoc(C.lessonPlans, l.id, leader ? extra : { status: to });
      void audit(`lesson.${to}`, `lessonPlans/${l.id}`, `${l.status} → ${to}`);
      setNote(''); toast.success(`Lesson is now ${STATUS_LABEL[to].toLowerCase()}.`);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const del = async () => {
    if (!window.confirm('Delete this lesson and its teacher guide permanently?')) return;
    try { await removeDoc(C.lessonGuides, l.id).catch(() => undefined); await removeDoc(C.lessonPlans, l.id); void audit('lesson.delete', `lessonPlans/${l.id}`, l.title); nav('/app/lms/lessons'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const canDelete = leader || (author && l.authorUid === uid && l.status === 'draft');
  const tabs: { id: Tab; label: string }[] = [{ id: 'lesson', label: 'Lesson' }, ...(staff ? [{ id: 'guide' as Tab, label: 'Teacher guide' }] : []), { id: 'resources', label: 'Resources' }, ...(staff ? [{ id: 'workflow' as Tab, label: 'Review & publish' }] : [])];

  return (
    <div>
      <PageHeader title={String(form.title || 'Untitled lesson')} description={[l.className, l.subjectName, l.week ? `Week ${l.week}` : ''].filter(Boolean).join(' · ')}
        actions={<div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={l.status} />
          {editable && <Button onClick={() => void save()} disabled={saving || !anyDirty}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}</Button>}
          <Button variant="outline" onClick={() => printIt(false)}><Printer className="h-4 w-4" /> Print</Button>
          <Button variant="outline" onClick={download} aria-label="Download lesson as HTML"><Download className="h-4 w-4" /></Button>
          {canDelete && <Button variant="ghost" onClick={() => void del()} aria-label="Delete lesson"><Trash2 className="h-4 w-4" /></Button>}
        </div>} />
      {editable && <p className="mb-3 text-xs text-muted" role="status">{anyDirty ? 'Unsaved changes — a copy is kept on this device and the lesson saves itself every 45 seconds.' : lastSaved ? `All changes saved at ${lastSaved.toLocaleTimeString()}.` : 'All changes saved.'} · {wordCount(form)} words</p>}
      {!editable && <p className="mb-3 rounded-md bg-cream px-3 py-2 text-sm text-muted"><Eye className="mr-1 inline h-4 w-4" /> {l.status === 'draft' ? 'Only the author can edit a draft.' : 'This lesson is locked while it is ' + STATUS_LABEL[l.status].toLowerCase() + '.'}</p>}
      {restore && editable && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-gold-300 bg-gold-50 px-3 py-2 text-sm" role="alert">
          <span>Unsaved work from this device was found and is newer than the saved lesson.</span>
          <Button size="sm" onClick={() => { setForm(restore.form); if (restore.guide) setGuide(restore.guide); setRestore(null); }}>Restore it</Button>
          <Button size="sm" variant="outline" onClick={() => { try { localStorage.removeItem(DRAFT_KEY(l.id)); } catch { /* ignore */ } setRestore(null); }}>Discard</Button>
        </div>
      )}
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'lesson' && (editable ? (
          <div className="space-y-5">
            <Card><CardBody className="grid gap-3 sm:grid-cols-3">
              <Field label="Lesson title" required className="sm:col-span-3">{(p) => <Input {...p} maxLength={200} value={String(form.title ?? '')} onChange={(e) => set('title', e.target.value)} />}</Field>
              <Field label="Duration (minutes)">{(p) => <Input {...p} type="number" min={5} max={240} value={String(form.durationMin ?? '')} onChange={(e) => set('durationMin', e.target.value ? Number(e.target.value) : '')} />}</Field>
              <Field label="Week (1–20)">{(p) => <Input {...p} type="number" min={1} max={20} value={String(form.week ?? '')} onChange={(e) => set('week', e.target.value ? Number(e.target.value) : '')} />}</Field>
              <Field label="Class / subject">{(p) => <Input {...p} readOnly value={[l.className, l.subjectName].filter(Boolean).join(' · ')} />}</Field>
              <Field label="Learning objectives (one per line)" required className="sm:col-span-3">{(p) => <Textarea {...p} value={(form.objectives as string[]).join('\n')} onChange={(e) => set('objectives', e.target.value.split('\n'))} />}</Field>
              <Field label="Previous knowledge" className="sm:col-span-3">{(p) => <div><RichTextEditor id={p.id} value={String(form.previousKnowledge ?? '')} onChange={(h) => set('previousKnowledge', h)} /></div>}</Field>
            </CardBody></Card>
            {RICH_SECTIONS.filter(([k]) => k !== 'previousKnowledge').map(([k, label]) => (
              <Field key={k} label={label} required={k === 'presentation'}>{(p) => <RichTextEditor id={p.id} value={String(form[k] ?? '')} onChange={(h) => set(k, h)} />}</Field>
            ))}
          </div>
        ) : <Reader l={view} />)}
        {tab === 'guide' && guide && (
          <div className="space-y-5">
            <p className="rounded-md bg-cream px-3 py-2 text-sm text-muted">The teacher guide is stored separately and is never shown to learners.</p>
            {GUIDE_SECTIONS.map(([k, label]) => (editable ? <Field key={k} label={label}>{(p) => <RichTextEditor id={p.id} value={guide[k] ?? ''} onChange={(h) => setGuide((g) => ({ ...(g ?? {}), [k]: h }))} />}</Field> : <div key={k}><h3 className="font-medium">{label}</h3><div className="prose-ela" dangerouslySetInnerHTML={{ __html: sanitizeHtml(guide[k] ?? '') || '<p>—</p>' }} /></div>))}
            <Button variant="outline" onClick={() => printIt(true)}><Printer className="h-4 w-4" /> Print lesson with guide</Button>
          </div>
        )}
        {tab === 'resources' && (
          <div className="space-y-4">
            {editable ? (
              <>
                <Field label="Instructional materials (one per line)">{(p) => <Textarea {...p} value={(form.materials as string[]).join('\n')} onChange={(e) => set('materials', e.target.value.split('\n'))} />}</Field>
                <Field label="References (one per line)">{(p) => <Textarea {...p} value={(form.references as string[]).join('\n')} onChange={(e) => set('references', e.target.value.split('\n'))} />}</Field>
                <div>
                  <h3 className="mb-2 text-sm font-medium">Supplementary resources (links)</h3>
                  {(form.supplementary as { title: string; url: string }[]).map((s, i) => (
                    <div key={i} className="mb-2 flex flex-wrap gap-2">
                      <Input aria-label="Resource title" placeholder="Title" className="min-w-40 flex-1" value={s.title} onChange={(e) => set('supplementary', (form.supplementary as { title: string; url: string }[]).map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                      <Input aria-label="Resource link" placeholder="https://…" className="min-w-40 flex-[2]" value={s.url} onChange={(e) => set('supplementary', (form.supplementary as { title: string; url: string }[]).map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} aria-invalid={!!s.url && !/^https?:\/\//i.test(s.url)} />
                      <Button variant="ghost" size="icon" aria-label="Remove resource" onClick={() => set('supplementary', (form.supplementary as unknown[]).filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => set('supplementary', [...(form.supplementary as unknown[]), { title: '', url: '' }])}><Plus className="h-4 w-4" /> Add link</Button>
                  <p className="mt-1 text-xs text-muted">Only web links starting with http:// or https:// are kept. For videos and slides use the Video and Presentation libraries (coming next).</p>
                </div>
              </>
            ) : <ResourceView l={view} />}
          </div>
        )}
        {tab === 'workflow' && staff && (
          <Card><CardBody className="space-y-3">
            <p className="text-sm">Status: <b>{STATUS_LABEL[l.status]}</b>. Authors send lessons for review; a principal or admin approves and publishes. Learners see a lesson only when it is published for their class.</p>
            {l.reviewNote && <p className="rounded-md bg-cream px-3 py-2 text-sm"><b>Reviewer note:</b> {l.reviewNote}</p>}
            {leader && (l.status === 'review' || l.status === 'approved') && <Field label="Note to the author (optional)">{(p) => <Textarea {...p} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />}</Field>}
            {next.length === 0 ? <p className="text-sm text-muted">No actions are available to you at this stage.</p> : (
              <div className="flex flex-wrap gap-2">
                {next.map((to) => <Button key={to} variant={to === 'published' || to === 'approved' ? 'primary' : 'outline'} onClick={() => void move(to)}>{to === 'review' ? 'Send for review' : to === 'draft' ? (l.status === 'review' ? (leader ? 'Return for changes' : 'Withdraw to draft') : 'Back to draft') : to === 'approved' ? (l.status === 'published' ? 'Unpublish (back to approved)' : 'Approve') : to === 'published' ? 'Publish to learners' : to === 'archived' ? 'Archive' : STATUS_LABEL[to]}</Button>)}
              </div>
            )}
            {l.publishedAt && l.status === 'published' && <p className="text-xs text-muted">Published {toDate(l.publishedAt)?.toLocaleString()}.</p>}
          </CardBody></Card>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- read-only views */
function Reader({ l }: { l: Record<string, unknown> }) {
  const objectives = (l.objectives as string[] | undefined) ?? [];
  return (
    <article className="space-y-5">
      {objectives.length > 0 && <section><h3 className="font-semibold">Learning objectives</h3><ul className="list-disc pl-5 text-sm">{objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></section>}
      {RICH_SECTIONS.map(([k, label]) => (String(l[k] ?? '').replace(/<[^>]*>/g, '').trim() || /<img\b/i.test(String(l[k] ?? ''))) ? (
        <section key={k}><h3 className="font-semibold">{label}</h3><div className="prose-ela" dangerouslySetInnerHTML={{ __html: sanitizeHtml(String(l[k])) }} /></section>
      ) : null)}
      <ResourceView l={l} />
    </article>
  );
}
function ResourceView({ l }: { l: Record<string, unknown> }) {
  const mats = (l.materials as string[] | undefined) ?? []; const refs = (l.references as string[] | undefined) ?? [];
  const sup = ((l.supplementary as { title: string; url: string }[] | undefined) ?? []).filter((s) => /^https?:\/\//i.test(s.url));
  if (!mats.length && !refs.length && !sup.length) return <p className="text-sm text-muted">No resources listed.</p>;
  return (
    <div className="space-y-3 text-sm">
      {mats.length > 0 && <section><h3 className="font-semibold">Instructional materials</h3><ul className="list-disc pl-5">{mats.filter(Boolean).map((m, i) => <li key={i}>{m}</li>)}</ul></section>}
      {refs.length > 0 && <section><h3 className="font-semibold">References</h3><ul className="list-disc pl-5">{refs.filter(Boolean).map((m, i) => <li key={i}>{m}</li>)}</ul></section>}
      {sup.length > 0 && <section><h3 className="font-semibold">Supplementary resources</h3><ul className="list-disc pl-5">{sup.map((s, i) => <li key={i}><a className="text-forest-600 underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a></li>)}</ul></section>}
    </div>
  );
}
