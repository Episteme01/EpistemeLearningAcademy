import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { ArrowDown, ArrowUp, Archive, Copy, Download, Pencil, Plus, Printer, RotateCcw, Trash2 } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { EmptyState, Spinner, StatusBadge, Tabs } from '@/components/ui/data';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { useSite } from '@/features/public/PublicLayout';
import { C } from '@/config/collections';
import { buildTree, canTransition, LEVELS, MAX_WEEKS, nextOrder, schemeProblems, schemeToCsvRows, schemeToHtml, sortRows, topicProblems, unplanned, type CurriculumStatus, type SchemeRow, type Topic } from '@/lib/curriculum';
import { toCsv } from '@/lib/csv';
import { downloadText, errorMessage, toDate } from '@/lib/utils';
import { deleteSchemeRow, deleteTopic, duplicateCurriculum, moveTopic, saveSchemeRow, saveTopic, setCurriculumStatus } from '@/services/curriculum';

type Row = Record<string, unknown> & { id: string };
interface Curriculum extends Row { title: string; status: CurriculumStatus; level?: string; sessionId?: string; sessionName?: string; termId?: string; termName?: string; classId?: string; className?: string; subjectId?: string; subjectName?: string; teacherUids?: string[]; teacherNames?: string[]; objectives?: string[]; competencies?: string[]; outcomes?: string[]; lessonDurationMin?: number; assessmentCriteria?: string; references?: string[]; version?: number }

const isLeader = (roles: string[]) => roles.some((r) => ['super_admin', 'principal', 'admin'].includes(r));

/* ------------------------------------------------------------------ list */
export function CurriculumList() {
  const { roles, uid } = useAuth();
  const nav = useNavigate(); const toast = useToast();
  const leader = isLeader(roles);
  const config: CrudConfig<Curriculum> = {
    collection: C.curricula, singular: 'Curriculum', plural: 'Curricula', auditActions: true, dialogSize: 'lg',
    description: 'Plan what is taught: objectives, topics and subtopics, then the week-by-week scheme of work. Open a curriculum to build its topics and scheme.',
    canDelete: false,
    fields: [
      { name: 'title', label: 'Curriculum title', type: 'text', required: true, maxLength: 160, placeholder: 'e.g. JSS 1 Mathematics 2026/2027' },
      { name: 'level', label: 'Educational level / programme', type: 'select', required: true, defaultValue: LEVELS[2], options: LEVELS.map((l) => ({ value: l, label: l })) },
      { name: 'sessionId', label: 'Academic session', type: 'ref', required: true, ref: { collection: C.academicSessions, label: (r) => String(r.name), labelField: 'sessionName' } },
      { name: 'termId', label: 'Term (optional)', type: 'ref', ref: { collection: C.terms, label: (r) => `${String(r.sessionName ?? '')} ${String(r.name)}`.trim(), labelField: 'termName' } },
      { name: 'classId', label: 'Class (optional for courses and adult programmes)', type: 'ref', ref: { collection: C.classes, label: (r) => String(r.name), labelField: 'className' } },
      { name: 'subjectId', label: 'Subject / course', type: 'ref', required: true, ref: { collection: C.subjects, label: (r) => String(r.name), labelField: 'subjectName' } },
      { name: 'teacherUids', label: 'Teachers assigned', type: 'multiref', ref: { collection: C.users, label: (r) => String(r.displayName ?? r.email), labelField: 'teacherNames', filter: (r) => ((r.roles as string[] | undefined) ?? [String(r.role)]).includes('teacher') }, hint: 'Assigned teachers can build the topics and scheme of work.' },
      { name: 'objectives', label: 'Learning objectives (one per line)', type: 'list' },
      { name: 'competencies', label: 'Competencies (one per line)', type: 'list' },
      { name: 'outcomes', label: 'Expected learning outcomes (one per line)', type: 'list' },
      { name: 'lessonDurationMin', label: 'Standard lesson duration (minutes)', type: 'number', min: 10, max: 240, defaultValue: 40 },
      { name: 'assessmentCriteria', label: 'Assessment criteria', type: 'textarea', hint: 'How learning will be assessed (tests, assignments, practicals, projects).' },
      { name: 'references', label: 'Reference materials (titles or links, one per line)', type: 'list' },
      { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: leader ? [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }] : [{ value: 'draft', label: 'Draft (a principal or admin publishes)' }] },
    ],
    columns: [
      { key: 't', header: 'Curriculum', primary: true, cell: (r) => <Link to={`/app/lms/curriculum/${r.id}`} className="font-medium text-forest-600 underline-offset-2 hover:underline">{r.title}</Link> },
      { key: 'c', header: 'Class', cell: (r) => r.className || '—' }, { key: 's', header: 'Subject', cell: (r) => r.subjectName }, { key: 'ss', header: 'Session', cell: (r) => r.sessionName },
      { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
    ],
    searchKeys: ['title', 'subjectName', 'className'],
    filters: [{ name: 'status', label: 'Status', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }, { value: 'archived', label: 'Archived' }] }],
    sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    beforeSave: (p, existing) => {
      const t = Array.isArray(p.teacherUids) ? [...(p.teacherUids as string[])] : [];
      if (!leader && uid && !t.includes(uid)) t.push(uid); // a teacher always stays on their own curriculum
      return { ...p, teacherUids: t, version: ((existing?.version as number) ?? 0) + 1, ...(leader ? {} : { status: 'draft' }) };
    },
    rowFilter: (r) => leader || (Array.isArray(r.teacherUids) && !!uid && (r.teacherUids as string[]).includes(uid)) || roles.includes('director'),
    rowActions: (r) => (
      <>
        <Button size="icon" variant="ghost" aria-label={`Open ${r.title}`} onClick={() => nav(`/app/lms/curriculum/${r.id}`)}><Pencil className="h-4 w-4" /></Button>
        <Button size="icon" variant="ghost" aria-label={`Duplicate ${r.title}`} onClick={() => { void duplicateCurriculum(r.id).then((id) => { toast.success('Copied as a draft.'); nav(`/app/lms/curriculum/${id}`); }).catch((e) => toast.error(errorMessage(e))); }}><Copy className="h-4 w-4" /></Button>
        {leader && r.status !== 'archived' && <Button size="icon" variant="ghost" aria-label={`Archive ${r.title}`} onClick={() => { void setCurriculumStatus(r.id, r.status, 'archived').then(() => toast.success('Archived.')).catch((e) => toast.error(errorMessage(e))); }}><Archive className="h-4 w-4" /></Button>}
        {leader && r.status === 'archived' && <Button size="icon" variant="ghost" aria-label={`Restore ${r.title}`} onClick={() => { void setCurriculumStatus(r.id, r.status, 'draft').then(() => toast.success('Restored as a draft.')).catch((e) => toast.error(errorMessage(e))); }}><RotateCcw className="h-4 w-4" /></Button>}
      </>
    ),
  };
  return <CrudPage config={config} />;
}

/* ------------------------------------------------------------------ detail */
type Tab = 'overview' | 'topics' | 'scheme';
export function CurriculumDetail() {
  const { id = '' } = useParams();
  const { roles, uid } = useAuth(); const toast = useToast();
  const cur = useDocument<Curriculum>(C.curricula, id);
  const topicsQ = useCollection<Topic>(C.curriculumTopics, () => [where('curriculumId', '==', id)], id);
  const rowsQ = useCollection<SchemeRow>(C.schemeOfWork, () => [where('curriculumId', '==', id)], id);
  const terms = useCollection<{ name: string; sessionId: string }>(C.terms, () => [], 'all');
  const [tab, setTab] = useState<Tab>('topics');
  const [termId, setTermId] = useState('');
  const site = useSite();
  const c = cur.data;
  const leader = isLeader(roles);
  const mine = !!c && !!uid && (c.teacherUids ?? []).includes(uid);
  const canPlan = leader || mine;
  const topics = topicsQ.data as unknown as Topic[]; const allRows = rowsQ.data as unknown as SchemeRow[];
  const termList = useMemo(() => terms.data.filter((t) => !c?.sessionId || t.sessionId === c.sessionId), [terms.data, c?.sessionId]);
  const activeTerm = termId || c?.termId || termList[0]?.id || '';
  const rows = useMemo(() => sortRows(allRows.filter((r) => r.termId === activeTerm)), [allRows, activeTerm]);
  const tree = useMemo(() => buildTree(topics), [topics]);
  if (cur.loading) return <Spinner />;
  if (!c) return <EmptyState title="Curriculum not found" description="It may have been deleted." action={<Link to="/app/lms/curriculum"><Button>Back to curricula</Button></Link>} />;
  const termName = termList.find((t) => t.id === activeTerm)?.name ?? c.termName ?? '';
  const meta = { school: site.name, title: c.title, className: c.className || '—', subjectName: c.subjectName || '', termName, teachers: (c.teacherNames ?? []).join(', ') };
  const printIt = () => { const w = window.open('', '_blank'); if (!w) { toast.error('Allow pop-ups to print.'); return; } w.document.write(schemeToHtml(meta, rows, topics)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300); };
  const csv = () => downloadText(`scheme-of-work-${c.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`, toCsv(schemeToCsvRows(rows, topics)), 'text/csv');
  const change = (to: CurriculumStatus) => { void setCurriculumStatus(c.id, c.status, to).then(() => toast.success(`Now ${to}.`)).catch((e) => toast.error(errorMessage(e))); };
  const list = (a?: string[]) => (a && a.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{a.map((x) => <li key={x}>{x}</li>)}</ul> : <p className="text-sm text-muted">Not set.</p>);
  return (
    <div>
      <PageHeader title={c.title} description={`${c.className || 'No class'} · ${c.subjectName ?? ''} · ${c.sessionName ?? ''} · ${c.level ?? ''}`}
        crumbs={<Link to="/app/lms/curriculum" className="text-sm text-forest-500 underline">← All curricula</Link>}
        actions={<><StatusBadge status={c.status} />{leader && c.status === 'draft' && <Button onClick={() => change('published')}>Publish</Button>}{leader && c.status === 'published' && <Button variant="outline" onClick={() => change('draft')}>Unpublish</Button>}{leader && canTransition(c.status, 'archived') && c.status !== 'archived' && <Button variant="outline" onClick={() => change('archived')}>Archive</Button>}</>} />
      <Tabs tabs={[{ id: 'topics', label: 'Topics & subtopics' }, { id: 'scheme', label: 'Scheme of work' }, { id: 'overview', label: 'Overview' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'overview' && (
          <div className="grid gap-4 md:grid-cols-2">
            {([['Learning objectives', c.objectives], ['Competencies', c.competencies], ['Expected learning outcomes', c.outcomes], ['Reference materials', c.references]] as const).map(([h, v]) => <Card key={h}><CardBody><h3 className="mb-2 font-heading text-lg">{h}</h3>{list(v as string[] | undefined)}</CardBody></Card>)}
            <Card><CardBody><h3 className="mb-2 font-heading text-lg">Assessment criteria</h3><p className="whitespace-pre-line text-sm">{c.assessmentCriteria || 'Not set.'}</p><p className="mt-3 text-xs text-muted">Standard lesson: {c.lessonDurationMin ?? '—'} min · Teachers: {(c.teacherNames ?? []).join(', ') || '—'} · Version {c.version ?? 1}</p></CardBody></Card>
          </div>
        )}
        {tab === 'topics' && <TopicsTab curriculumId={c.id} tree={tree} topics={topics} rows={allRows} canPlan={canPlan} />}
        {tab === 'scheme' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Term">{(a) => <Select {...a} value={activeTerm} onChange={(e) => setTermId(e.target.value)}>{termList.length === 0 && <option value="">No terms for this session</option>}{termList.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>}</Field>
              <Button variant="outline" onClick={printIt}><Printer className="h-4 w-4" />Print / PDF</Button><Button variant="outline" onClick={csv}><Download className="h-4 w-4" />CSV</Button>
            </div>
            <SchemeTab curriculum={c} termId={activeTerm} topics={topics} rows={rows} canPlan={canPlan && !!activeTerm} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ topics */
function TopicsTab({ curriculumId, tree, topics, rows, canPlan }: { curriculumId: string; tree: ReturnType<typeof buildTree>; topics: Topic[]; rows: SchemeRow[]; canPlan: boolean }) {
  const toast = useToast();
  const [dlg, setDlg] = useState<{ id: string | null; parentId: string } | null>(null);
  const [del, setDel] = useState<Topic | null>(null);
  const [f, setF] = useState({ title: '', objectives: '', outcomes: '', durationMin: '' });
  const open = (id: string | null, parentId: string) => { const t = topics.find((x) => x.id === id); setF({ title: t?.title ?? '', objectives: t?.objectives ?? '', outcomes: t?.outcomes ?? '', durationMin: t?.durationMin ? String(t.durationMin) : '' }); setDlg({ id, parentId }); };
  const save = async () => {
    if (!dlg) return;
    const probs = topicProblems({ id: dlg.id ?? undefined, parentId: dlg.parentId, title: f.title }, topics);
    if (probs.length) { toast.error(probs.join(' ')); return; }
    try {
      const sibs = topics.filter((t) => t.parentId === dlg.parentId);
      await saveTopic(curriculumId, dlg.id, { parentId: dlg.parentId, title: f.title.trim(), order: dlg.id ? (topics.find((t) => t.id === dlg.id)?.order ?? 1) : nextOrder(sibs), objectives: f.objectives.trim(), outcomes: f.outcomes.trim(), ...(f.durationMin ? { durationMin: Number(f.durationMin) } : {}) });
      setDlg(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const mv = (sibs: Topic[], id: string, d: -1 | 1) => { void moveTopic(sibs, id, d).catch((e) => toast.error(errorMessage(e))); };
  const Btns = ({ t, sibs }: { t: Topic; sibs: Topic[] }) => canPlan ? (
    <span className="flex shrink-0 gap-1">
      <Button size="icon" variant="ghost" aria-label={`Move ${t.title} up`} onClick={() => mv(sibs, t.id, -1)}><ArrowUp className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={`Move ${t.title} down`} onClick={() => mv(sibs, t.id, 1)}><ArrowDown className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={`Edit ${t.title}`} onClick={() => open(t.id, t.parentId)}><Pencil className="h-4 w-4" /></Button>
      <Button size="icon" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => setDel(t)}><Trash2 className="h-4 w-4" /></Button>
    </span>) : null;
  return (
    <div className="space-y-3">
      {canPlan && <Button onClick={() => open(null, '')}><Plus className="h-4 w-4" />Add topic</Button>}
      {tree.length === 0 && <EmptyState title="No topics yet" description="Add the main topics, then add subtopics under each." />}
      {tree.map((n, i) => (
        <Card key={n.topic.id}><CardBody>
          <div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{i + 1}. {n.topic.title}</p>{n.topic.objectives && <p className="mt-1 text-xs text-muted">{n.topic.objectives}</p>}</div><Btns t={n.topic} sibs={tree.map((x) => x.topic)} /></div>
          <ul className="mt-2 space-y-1 border-l-2 border-gold-300 pl-3">
            {n.children.map((s, k) => <li key={s.id} className="flex items-start justify-between gap-2 text-sm"><span>{i + 1}.{k + 1} {s.title}{s.durationMin ? <span className="text-xs text-muted"> · {s.durationMin} min</span> : null}</span><Btns t={s} sibs={n.children} /></li>)}
          </ul>
          {canPlan && <Button size="sm" variant="ghost" className="mt-2" onClick={() => open(null, n.topic.id)}><Plus className="h-4 w-4" />Add subtopic</Button>}
        </CardBody></Card>
      ))}
      <Dialog open={!!dlg} onClose={() => setDlg(null)} title={`${dlg?.id ? 'Edit' : 'Add'} ${dlg?.parentId ? 'subtopic' : 'topic'}`}
        footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
        <div className="space-y-3">
          <Field label="Title" required>{(a) => <Input {...a} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} autoFocus />}</Field>
          <Field label="Learning objectives">{(a) => <Textarea {...a} rows={3} value={f.objectives} onChange={(e) => setF({ ...f, objectives: e.target.value })} />}</Field>
          <Field label="Expected outcomes">{(a) => <Textarea {...a} rows={2} value={f.outcomes} onChange={(e) => setF({ ...f, outcomes: e.target.value })} />}</Field>
          <Field label="Suggested time (minutes)">{(a) => <Input {...a} type="number" min={0} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />}</Field>
        </div>
      </Dialog>
      <Dialog open={!!del} onClose={() => setDel(null)} size="sm" title="Delete this item?" description={del ? `“${del.title}”${topics.some((t) => t.parentId === del.id) ? ' and its subtopics' : ''} will be removed, together with any weekly-plan entries that use them.` : ''}
        footer={<><Button variant="outline" onClick={() => setDel(null)}>Cancel</Button><Button variant="danger" onClick={() => { const t = del!; setDel(null); void deleteTopic(t, topics, rows).catch((e) => toast.error(errorMessage(e))); }}>Delete</Button></>}><span /></Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ scheme of work */
const blank = { week: '1', topicId: '', subtopicId: '', objectives: '', activities: '', materials: '', assessment: '', outcomes: '', teacherUid: '', notes: '' };
function SchemeTab({ curriculum, termId, topics, rows, canPlan }: { curriculum: Curriculum; termId: string; topics: Topic[]; rows: SchemeRow[]; canPlan: boolean }) {
  const toast = useToast();
  const [dlg, setDlg] = useState<{ id: string | null } | null>(null);
  const [f, setF] = useState(blank);
  const name = (id: string) => topics.find((t) => t.id === id)?.title ?? '—';
  const tops = topics.filter((t) => !t.parentId).sort((a, b) => a.order - b.order);
  const subs = topics.filter((t) => t.parentId === f.topicId).sort((a, b) => a.order - b.order);
  const teachers = (curriculum.teacherUids ?? []).map((u, i) => ({ uid: u, name: curriculum.teacherNames?.[i] ?? u }));
  const open = (r?: SchemeRow) => { setF(r ? { week: String(r.week), topicId: r.topicId, subtopicId: r.subtopicId, objectives: r.objectives, activities: r.activities, materials: r.materials, assessment: r.assessment, outcomes: r.outcomes, teacherUid: r.teacherUid, notes: r.notes ?? '' } : { ...blank, week: String((rows.at(-1)?.week ?? 0) + 1), teacherUid: teachers.length === 1 ? teachers[0].uid : '' }); setDlg({ id: r?.id ?? null }); };
  const todo = unplanned(topics, rows);
  const save = async () => {
    const probs = schemeProblems({ id: dlg?.id ?? '', week: Number(f.week), topicId: f.topicId, subtopicId: f.subtopicId, termId }, rows, topics);
    if (probs.length) { toast.error(probs.join(' ')); return; }
    try {
      await saveSchemeRow(curriculum.id, dlg!.id, { termId, week: Number(f.week), topicId: f.topicId, subtopicId: f.subtopicId, objectives: f.objectives.trim(), activities: f.activities.trim(), materials: f.materials.trim(), assessment: f.assessment.trim(), outcomes: f.outcomes.trim(), teacherUid: f.teacherUid, teacherName: teachers.find((t) => t.uid === f.teacherUid)?.name ?? '', notes: f.notes.trim() });
      setDlg(null);
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const area = (k: 'objectives' | 'activities' | 'materials' | 'assessment' | 'outcomes', label: string) => <Field label={label}>{(a) => <Textarea {...a} rows={2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>;
  return (
    <div className="space-y-4">
      {canPlan && <Button onClick={() => open()} disabled={tops.length === 0}><Plus className="h-4 w-4" />Add week entry</Button>}
      {tops.length === 0 && <p className="text-sm text-muted">Add topics first (Topics &amp; subtopics tab), then plan them week by week.</p>}
      {rows.length === 0 && tops.length > 0 && <EmptyState title="No weeks planned for this term" description="Add a week entry to start the scheme of work." />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line bg-white"><table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-cream text-xs uppercase text-muted"><tr><th className="p-2">Week</th><th className="p-2">Topic / subtopic</th><th className="p-2">Objectives</th><th className="p-2">Activities</th><th className="p-2">Materials</th><th className="p-2">Assessment</th><th className="p-2" /></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id} className="border-t border-line align-top"><td className="p-2 font-semibold">{r.week}</td><td className="p-2"><b>{name(r.topicId)}</b>{r.subtopicId && <div className="text-xs text-muted">{name(r.subtopicId)}</div>}</td><td className="p-2">{r.objectives}</td><td className="p-2">{r.activities}</td><td className="p-2">{r.materials}</td><td className="p-2">{r.assessment}</td>
            <td className="whitespace-nowrap p-2">{canPlan && <><Button size="icon" variant="ghost" aria-label={`Edit week ${r.week}`} onClick={() => open(r)}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label={`Delete week ${r.week} entry`} onClick={() => { if (window.confirm('Delete this week entry?')) void deleteSchemeRow(r.id).catch((e) => toast.error(errorMessage(e))); }}><Trash2 className="h-4 w-4" /></Button></>}</td></tr>)}</tbody></table></div>
      )}
      {topics.length > 0 && <p className={`rounded-md p-3 text-sm ${todo.length ? 'bg-gold-100' : 'bg-forest-50'}`}>{todo.length ? <>Not yet planned this term: {todo.map((t) => t.title).join(', ')}.</> : 'Every topic is planned in this term.'}</p>}
      <Dialog open={!!dlg} onClose={() => setDlg(null)} size="lg" title={dlg?.id ? 'Edit week entry' : 'Add week entry'} footer={<><Button variant="outline" onClick={() => setDlg(null)}>Cancel</Button><Button onClick={() => void save()}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Week" required>{(a) => <Input {...a} type="number" min={1} max={MAX_WEEKS} value={f.week} onChange={(e) => setF({ ...f, week: e.target.value })} />}</Field>
          <Field label="Teacher">{(a) => <Select {...a} value={f.teacherUid} onChange={(e) => setF({ ...f, teacherUid: e.target.value })}><option value="">—</option>{teachers.map((t) => <option key={t.uid} value={t.uid}>{t.name}</option>)}</Select>}</Field>
          <Field label="Topic" required>{(a) => <Select {...a} value={f.topicId} onChange={(e) => { const t = topics.find((x) => x.id === e.target.value); setF({ ...f, topicId: e.target.value, subtopicId: '', objectives: f.objectives || t?.objectives || '', outcomes: f.outcomes || t?.outcomes || '' }); }}><option value="">Choose…</option>{tops.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>
          <Field label="Subtopic">{(a) => <Select {...a} value={f.subtopicId} onChange={(e) => setF({ ...f, subtopicId: e.target.value })}><option value="">Whole topic</option>{subs.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>}</Field>
          <div className="sm:col-span-2">{area('objectives', 'Learning objectives')}</div><div>{area('activities', 'Teaching activities')}</div><div>{area('materials', 'Instructional materials')}</div><div>{area('assessment', 'Assessment method')}</div><div>{area('outcomes', 'Expected outcomes')}</div>
          <div className="sm:col-span-2"><Field label="Notes">{(a) => <Input {...a} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />}</Field></div>
        </div>
      </Dialog>
    </div>
  );
}
