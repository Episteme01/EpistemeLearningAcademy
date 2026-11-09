import { useMemo, useRef, useState } from 'react';
import { Copy, Pencil, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, EmptyState, Spinner } from '@/components/ui/data';
import { ConfirmDialog, Dialog, useToast } from '@/components/ui/overlay';
import { MediaPreview, kindOfItem } from '@/components/common/MediaPickerDialog';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { createDoc, patchDoc, removeDoc } from '@/services/db';
import { audit } from '@/services/audit';
import { ACCEPT_ALL, deleteMediaFile, uploadToMedia } from '@/services/storage';
import { precheck } from '@/lib/filePolicy';
import { UPLOADS_OFF_MESSAGE } from '@/services/files';
import { C } from '@/config/collections';
import { flags } from '@/config/env';
import { KIND_LABEL, normaliseTags } from '@/lib/resources';
import { errorMessage } from '@/lib/utils';
import type { MediaItem, MediaKind, WithId } from '@/types/models';

const fmtSize = (n?: number) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Website media library: upload many files, search, filter by type or folder, edit details, copy links, delete. */
export function MediaLibrary() {
  const toast = useToast();
  const { role, roles } = useAuth();
  const { data, loading } = useCollection<MediaItem>(C.media, () => [], 'all');
  const [q, setQ] = useState(''); const [kind, setKind] = useState<MediaKind | ''>(''); const [folder, setFolder] = useState('');
  const [url, setUrl] = useState('');
  const [upFolder, setUpFolder] = useState('');
  const [prog, setProg] = useState<{ done: number; total: number; pct: number } | null>(null);
  const [edit, setEdit] = useState<{ item: WithId<MediaItem>; name: string; alt: string; folder: string; tags: string; description: string } | null>(null);
  const [del, setDel] = useState<WithId<MediaItem> | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canDelete = role !== 'cms_author';

  const rows = useMemo(() => data.map((m) => ({ ...m, k: kindOfItem(m) })), [data]);
  const folders = useMemo(() => [...new Set(rows.map((m) => m.folder).filter((x): x is string => !!x))].sort(), [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((m) => (!kind || m.k === kind) && (!folder || (folder === '__none' ? !m.folder : m.folder === folder)) && (!s || `${m.name} ${m.alt ?? ''} ${(m.tags ?? []).join(' ')} ${m.folder ?? ''}`.toLowerCase().includes(s)));
  }, [rows, q, kind, folder]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files]; let ok = 0;
    for (let i = 0; i < list.length; i += 1) {
      const f = list[i]!; const p = flags.uploads ? precheck('media_public', roles, f) : UPLOADS_OFF_MESSAGE;
      if (p) { toast.error(`${f.name}: ${p}`); continue; }
      try { setProg({ done: i, total: list.length, pct: 0 }); await uploadToMedia(f, roles, (pct) => setProg({ done: i, total: list.length, pct }), '', { folder: upFolder.trim(), tags: [] }); ok += 1; }
      catch (e) { toast.error(`${f.name}: ${errorMessage(e)}`); }
    }
    setProg(null);
    if (ok) { toast.success(`${ok} file${ok > 1 ? 's' : ''} uploaded`); void audit('media.upload', 'media', `${ok} file(s)`); }
  };
  const addUrl = async () => {
    if (!/^https:\/\//.test(url)) return toast.error('Enter a full https:// image URL');
    try { await createDoc(C.media, { name: decodeURIComponent(url.split('?')[0]!.split('/').pop() || 'image'), url, source: 'url', kind: 'image', alt: '', folder: upFolder.trim(), tags: [] }); setUrl(''); toast.success('Added to library'); } catch (e) { toast.error(errorMessage(e)); }
  };
  const save = async () => {
    if (!edit) return; setBusy(true);
    try { await patchDoc(C.media, edit.item.id, { name: edit.name.trim() || edit.item.name, alt: edit.alt.trim(), folder: edit.folder.trim(), tags: normaliseTags(edit.tags), description: edit.description.trim() }); toast.success('Saved'); setEdit(null); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="Media library" description="Images, audio, video and documents for the website and lessons. Files here are public by link."
        actions={flags.uploads ? <><Button loading={prog !== null} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload files</Button>
          <input ref={fileRef} type="file" multiple hidden accept={ACCEPT_ALL} onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></> : undefined} />
      <Card className="mb-4"><CardBody className="space-y-3">
        {prog && <p className="text-sm text-muted">Uploading file {prog.done + 1} of {prog.total}… {prog.pct}%</p>}
        <div className="grid gap-2 md:grid-cols-4">
          <Input aria-label="Search" placeholder="Search name, tag, folder" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as MediaKind | '')}><option value="">All types</option>{(['image', 'audio', 'video', 'document'] as MediaKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
          <Select aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}><option value="">All folders</option><option value="__none">No folder</option>{folders.map((f) => <option key={f} value={f}>{f}</option>)}</Select>
          <Input aria-label="Folder for new files" list="media-folders" placeholder="Folder for new files (optional)" value={upFolder} onChange={(e) => setUpFolder(e.target.value)} />
          <datalist id="media-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        </div>
        <div className="flex flex-wrap gap-2"><Input aria-label="Image URL" className="min-w-60 flex-1" placeholder="Or add an image by URL (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} /><Button variant="outline" onClick={() => void addUrl()}>Add URL</Button></div>
        {!flags.uploads && <p className="text-xs text-muted">Uploads are not switched on yet. Set up the file service (docs/PHASE4B_FILE_STORAGE.md) and add its URL in src/config/files.json.</p>}
      </CardBody></Card>

      {loading ? <Spinner /> : shown.length === 0 ? <Card><EmptyState title={data.length ? 'Nothing matches your filters' : 'Library is empty'} description="Upload files or add an image by URL." /></Card> : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">{shown.map((m) => (
          <Card key={m.id} className="overflow-hidden">
            <MediaPreview item={{ name: m.name, url: m.url, alt: m.alt, kind: m.k }} />
            <div className="space-y-1 p-2">
              <p className="truncate text-xs font-medium" title={m.name}>{m.name}</p>
              <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted"><Badge>{KIND_LABEL[m.k]}</Badge>{fmtSize(m.size)}{m.folder ? ` · ${m.folder}` : ''}</p>
              {(m.tags ?? []).length > 0 && <p className="truncate text-[11px] text-muted">#{(m.tags ?? []).join(' #')}</p>}
              <div className="flex gap-3 pt-1">
                <button aria-label={`Copy link to ${m.name}`} onClick={() => void navigator.clipboard?.writeText(m.url).then(() => toast.success('Link copied'))}><Copy className="h-4 w-4 text-muted" /></button>
                <button aria-label={`Edit ${m.name}`} onClick={() => setEdit({ item: m, name: m.name, alt: m.alt ?? '', folder: m.folder ?? '', tags: (m.tags ?? []).join(', '), description: m.description ?? '' })}><Pencil className="h-4 w-4 text-muted" /></button>
                {canDelete && <button aria-label={`Delete ${m.name}`} onClick={() => setDel(m)}><Trash2 className="h-4 w-4 text-danger" /></button>}
              </div>
            </div>
          </Card>))}</div>)}

      <Dialog open={!!edit} onClose={() => setEdit(null)} title="Edit file details" footer={<><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={() => void save()}>Save</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Name">{(a) => <Input {...a} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />}</Field>
          {kindOfItem(edit.item) === 'image' && <Field label="Alt text (describes the picture for screen readers)">{(a) => <Input {...a} value={edit.alt} onChange={(e) => setEdit({ ...edit, alt: e.target.value })} />}</Field>}
          <Field label="Folder">{(a) => <Input {...a} list="media-folders" value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} />}</Field>
          <Field label="Tags (comma separated)">{(a) => <Input {...a} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />}</Field>
          <Field label="Description">{(a) => <Textarea {...a} rows={2} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
        </div>}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} title="Delete file?" message="Anything using this file will stop showing it. The stored copy is removed too." onConfirm={async () => { if (!del) return; try { await deleteMediaFile(del.ref).catch(() => undefined); await removeDoc(C.media, del.id); void audit('media.delete', del.id, del.name); toast.success('Deleted'); } catch (e) { toast.error(errorMessage(e)); } setDel(null); }} />
    </>
  );
}
