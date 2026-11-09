import { useMemo, useRef, useState } from 'react';
import { where } from 'firebase/firestore';
import { Eye, EyeOff, ExternalLink, Library, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, EmptyState, ErrorState, Spinner } from '@/components/ui/data';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/overlay';
import { MediaPickerDialog, MediaPreview } from '@/components/common/MediaPickerDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { createResource, deleteResource, setPublished, updateResource, type ResourceInput } from '@/services/resources';
import { ACCEPT_ALL, kindOf, uploadFile, validateUpload } from '@/services/storage';
import { C } from '@/config/collections';
import { flags } from '@/config/env';
import { KIND_LABEL, filterResources, kindFromUrl, youtubeId } from '@/lib/resources';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';
import type { ClassRoom, Course, MediaKind, Resource, ResourceAudience, WithId } from '@/types/models';

const AUDIENCES: { id: ResourceAudience; label: string }[] = [{ id: 'student', label: 'Students' }, { id: 'parent', label: 'Parents' }, { id: 'teacher', label: 'Teachers' }];
const blank = (): ResourceInput => ({ title: '', description: '', kind: 'link', fileKind: 'link', url: '', subject: '', courseId: '', courseName: '', classId: '', className: '', tags: '', visibleTo: ['student', 'parent'], published: true });
const sizeLabel = (n?: number) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Central resources centre: staff publish files, library items and links; learners and parents browse what is shared with them. */
export function ResourcesPage() {
  const { uid, role, profile } = useAuth();
  const toast = useToast();
  const leader = role === 'super_admin' || role === 'admin' || role === 'principal';
  const manage = leader || role === 'teacher';
  const readAll = manage || role === 'director';
  const viewerRole = role === 'student' || role === 'parent' ? role : null;

  const res = useCollection<Resource>(C.resources, () => {
    if (!uid) return null;
    if (readAll) return [];
    if (viewerRole) return [where('published', '==', true), where('visibleTo', 'array-contains', viewerRole)];
    return null;
  }, `${role}|${uid}`);
  const classes = useCollection<ClassRoom>(C.classes, () => (manage ? [] : null), manage ? 'on' : 'off');
  const courses = useCollection<Course>(C.courses, () => (manage ? [] : null), manage ? 'on' : 'off');

  const [f, setF] = useState({ q: '', kind: '' as MediaKind | '', subject: '', tag: '', published: '' as 'yes' | 'no' | '', mine: false });
  const [form, setForm] = useState<{ id?: string; v: ResourceInput; storagePath?: string } | null>(null);
  const [view, setView] = useState<WithId<Resource> | null>(null);
  const [del, setDel] = useState<WithId<Resource> | null>(null);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false); const [prog, setProg] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subjects = useMemo(() => [...new Set(res.data.map((r) => r.subject).filter((x): x is string => !!x))].sort(), [res.data]);
  const tags = useMemo(() => [...new Set(res.data.flatMap((r) => r.tags))].sort(), [res.data]);
  const shown = useMemo(() => filterResources(res.data.filter((r) => !f.mine || r.createdBy === uid), { q: f.q, kind: f.kind, subject: f.subject, tag: f.tag, published: manage ? f.published : '' })
    .sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0) || a.title.localeCompare(b.title)), [res.data, f, manage, uid]);
  const canEdit = (r: Resource) => leader || (role === 'teacher' && r.createdBy === uid);
  const set = (p: Partial<ResourceInput>) => setForm((x) => (x ? { ...x, v: { ...x.v, ...p } } : x));

  const onFile = async (file?: File) => {
    if (!file || !form) return;
    const p = validateUpload(file); if (p) return toast.error(p);
    try {
      setProg(0); const { url, path } = await uploadFile('lms/resources', file, setProg);
      setForm({ ...form, storagePath: path, v: { ...form.v, kind: 'file', fileKind: kindOf(file.type) ?? 'document', url, contentType: file.type, size: file.size, fileName: file.name, title: form.v.title || file.name.replace(/\.[^.]+$/, '') } });
      toast.success('File uploaded');
    } catch (e) { toast.error(errorMessage(e)); } finally { setProg(null); }
  };
  const save = async () => {
    if (!form || !uid) return; setBusy(true);
    try {
      const v: ResourceInput = { ...form.v, storagePath: form.storagePath ?? form.v.storagePath };
      if (v.kind === 'link' && !v.contentType) v.fileKind = kindFromUrl(v.url);
      const cls = classes.data.find((c) => c.id === v.classId); const crs = courses.data.find((c) => c.id === v.courseId);
      v.className = cls?.name ?? ''; v.courseName = crs?.title ?? '';
      if (form.id) await updateResource(form.id, v); else await createResource(v, { uid, name: profile?.displayName ?? '' });
      toast.success(form.id ? 'Resource updated' : 'Resource added'); setForm(null);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Resources" description={manage ? 'Share study materials, recordings, worksheets and links with learners and parents.' : 'Study materials shared by your teachers.'}
        actions={manage ? <Button onClick={() => setForm({ v: blank() })}><Plus className="h-4 w-4" /> Add resource</Button> : undefined} />
      <Card className="mb-4"><CardBody className="grid gap-2 md:grid-cols-5">
        <Input aria-label="Search" placeholder="Search resources" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
        <Select aria-label="Type" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as MediaKind | '' })}><option value="">All types</option>{(['document', 'video', 'audio', 'image', 'link'] as MediaKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        <Select aria-label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })}><option value="">All subjects</option>{subjects.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <Select aria-label="Tag" value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })}><option value="">All tags</option>{tags.map((s) => <option key={s} value={s}>#{s}</option>)}</Select>
        {manage ? <Select aria-label="Status" value={f.published} onChange={(e) => setF({ ...f, published: e.target.value as 'yes' | 'no' | '' })}><option value="">Published and drafts</option><option value="yes">Published</option><option value="no">Drafts</option></Select> : <span />}
        {manage && <label className="flex items-center gap-2 text-sm md:col-span-5"><input type="checkbox" className="accent-forest-700" checked={f.mine} onChange={(e) => setF({ ...f, mine: e.target.checked })} /> Only my resources</label>}
      </CardBody></Card>

      {res.error ? <ErrorState message={res.error} /> : res.loading ? <Spinner /> : shown.length === 0 ? <Card><EmptyState title={res.data.length ? 'Nothing matches your filters' : 'No resources yet'} description={manage ? 'Use "Add resource" to share the first one.' : 'Your teachers have not shared anything with you yet.'} /></Card> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((r) => (
          <Card key={r.id} className="flex flex-col overflow-hidden">
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge>{KIND_LABEL[r.fileKind]}</Badge>{manage && !r.published && <Badge tone="warn">Draft</Badge>}{r.subject && <Badge tone="info">{r.subject}</Badge>}{r.className && <Badge>{r.className}</Badge>}</div>
              <h3 className="font-heading text-base">{r.title}</h3>
              {r.description && <p className="line-clamp-3 text-sm text-muted">{r.description}</p>}
              {r.tags.length > 0 && <p className="text-xs text-muted">#{r.tags.join(' #')}</p>}
              <p className="mt-auto text-xs text-muted">{r.createdByName ? `${r.createdByName} · ` : ''}{fmtDate(r.createdAt)}{r.size ? ` · ${sizeLabel(r.size)}` : ''}</p>
              {manage && <p className="text-xs text-muted">Visible to: {r.visibleTo.join(', ')}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
              <Button size="sm" onClick={() => setView(r)}>Open</Button>
              {canEdit(r) && <>
                <Button size="sm" variant="outline" aria-label="Edit" onClick={() => setForm({ id: r.id, storagePath: r.storagePath, v: { title: r.title, description: r.description ?? '', kind: r.kind, fileKind: r.fileKind, url: r.url, storagePath: r.storagePath, contentType: r.contentType, size: r.size, fileName: r.fileName, subject: r.subject ?? '', courseId: r.courseId ?? '', courseName: r.courseName ?? '', classId: r.classId ?? '', className: r.className ?? '', tags: r.tags.join(', '), visibleTo: r.visibleTo, published: r.published } })}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" aria-label={r.published ? 'Unpublish' : 'Publish'} onClick={() => void setPublished(r, !r.published).then(() => toast.success(r.published ? 'Unpublished' : 'Published')).catch((e) => toast.error(errorMessage(e)))}>{r.published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                <Button size="sm" variant="outline" aria-label="Delete" onClick={() => setDel(r)}><Trash2 className="h-4 w-4 text-danger" /></Button></>}
            </div>
          </Card>))}</div>)}

      <Dialog open={!!view} onClose={() => setView(null)} title={view?.title ?? ''} description={view ? `${KIND_LABEL[view.fileKind]}${view.subject ? ` · ${view.subject}` : ''}` : undefined} size="xl">
        {view && <div className="space-y-3">
          {youtubeId(view.url) ? <iframe title={view.title} className="aspect-video w-full rounded-md" src={`https://www.youtube-nocookie.com/embed/${youtubeId(view.url)}`} allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen />
            : view.fileKind === 'document' && /\.pdf(\?|$)|pdf/i.test(`${view.url} ${view.contentType ?? ''}`) && view.kind === 'file' ? <iframe title={view.title} src={view.url} className="h-[70vh] w-full rounded-md border border-line" />
            : view.kind === 'file' || view.fileKind === 'image' || view.fileKind === 'audio' || view.fileKind === 'video' ? <MediaPreview item={{ name: view.title, url: view.url, kind: view.fileKind }} className="aspect-video" /> : null}
          {view.description && <p className="whitespace-pre-line text-sm">{view.description}</p>}
          <a href={view.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-forest-700 underline"><ExternalLink className="h-4 w-4" /> Open in a new tab / download</a>
        </div>}
      </Dialog>

      <Dialog open={!!form} onClose={() => setForm(null)} title={form?.id ? 'Edit resource' : 'Add resource'} size="lg" footer={<><Button variant="outline" onClick={() => setForm(null)}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
        {form && <div className="space-y-4">
          <div className="rounded-md border border-line p-3">
            <p className="mb-2 text-sm font-medium">What are you sharing?</p>
            <div className="flex flex-wrap gap-2">
              {flags.uploads && <Button size="sm" variant="outline" loading={prog !== null} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload a file</Button>}
              <input ref={fileRef} type="file" hidden accept={ACCEPT_ALL} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
              <Button size="sm" variant="outline" onClick={() => setPick(true)}><Library className="h-4 w-4" /> From media library</Button>
            </div>
            {prog !== null && <p className="mt-2 text-xs text-muted">Uploading… {prog}%</p>}
            <Field label="Or paste a link (YouTube, Google Drive, website…)" className="mt-3">{(a) => <Input {...a} placeholder="https://…" value={form.v.kind === 'link' ? form.v.url : ''} onChange={(e) => setForm({ ...form, storagePath: undefined, v: { ...form.v, kind: 'link', url: e.target.value, fileKind: kindFromUrl(e.target.value), contentType: '', size: undefined, fileName: '' } })} />}</Field>
            {form.v.url && <p className="mt-2 truncate text-xs text-muted">Selected: {form.v.fileName || form.v.url} ({KIND_LABEL[form.v.fileKind]})</p>}
            {flags.uploads && <p className="mt-1 text-xs text-muted">Uploaded files are stored privately for signed-in users. Library files are public by link.</p>}
          </div>
          <Field label="Title" required>{(a) => <Input {...a} value={form.v.title} onChange={(e) => set({ title: e.target.value })} />}</Field>
          <Field label="Description">{(a) => <Textarea {...a} rows={3} value={form.v.description} onChange={(e) => set({ description: e.target.value })} />}</Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Subject">{(a) => <Input {...a} value={form.v.subject} onChange={(e) => set({ subject: e.target.value })} />}</Field>
            <Field label="Class (optional)">{(a) => <Select {...a} value={form.v.classId} onChange={(e) => set({ classId: e.target.value })}><option value="">All classes</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
            <Field label="Course (optional)">{(a) => <Select {...a} value={form.v.courseId} onChange={(e) => set({ courseId: e.target.value })}><option value="">Any</option>{courses.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
          </div>
          <Field label="Tags (comma separated)">{(a) => <Input {...a} value={Array.isArray(form.v.tags) ? form.v.tags.join(', ') : form.v.tags} onChange={(e) => set({ tags: e.target.value })} />}</Field>
          <fieldset className="rounded-md border border-line p-3"><legend className="px-1 text-sm font-medium">Who can see it</legend>
            <div className="flex flex-wrap gap-4">{AUDIENCES.map((a) => <Checkbox key={a.id} label={a.label} checked={form.v.visibleTo.includes(a.id)} onChange={(e) => set({ visibleTo: e.target.checked ? [...form.v.visibleTo, a.id] : form.v.visibleTo.filter((x) => x !== a.id) })} />)}</div>
            <p className="mt-2 text-xs text-muted">Teachers and school leaders always see every resource. Class and course are labels for filtering; they do not restrict access.</p></fieldset>
          <Checkbox label="Published (visible to the people selected above)" checked={form.v.published} onChange={(e) => set({ published: e.target.checked })} />
        </div>}
      </Dialog>
      <MediaPickerDialog open={pick} onClose={() => setPick(false)} title="Pick from the media library" includeBundled={false}
        onPick={(m) => form && setForm({ ...form, storagePath: undefined, v: { ...form.v, kind: 'file', fileKind: m.kind, url: m.url, contentType: m.contentType ?? '', size: m.size, fileName: m.name, title: form.v.title || m.name.replace(/\.[^.]+$/, '') } })} />
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete resource?" message="Learners will no longer see it. An uploaded file is deleted too." onConfirm={async () => { if (!del) return; try { await deleteResource(del); toast.success('Deleted'); } catch (e) { toast.error(errorMessage(e)); } setDel(null); }} />
    </>
  );
}
