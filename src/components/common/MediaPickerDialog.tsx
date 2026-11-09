import { useMemo, useRef, useState } from 'react';
import { FileText, Link2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Tabs } from '@/components/ui/data';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { flags } from '@/config/env';
import { asset } from '@/config/brand';
import { ACCEPT_ALL, kindOf, uploadToMedia, validateUpload, type FileKind } from '@/services/storage';
import { KIND_LABEL } from '@/lib/resources';
import { errorMessage } from '@/lib/utils';
import type { MediaItem, MediaKind } from '@/types/models';

export interface PickedMedia { id: string; name: string; url: string; kind: MediaKind; contentType?: string; size?: number }

const BUNDLED = ['classroom', 'founder', 'consultation', 'islamic-study', 'digital-hub', 'curriculum', 'skills', 'ielts', 'holistic', 'flexible', 'learning']
  .map((n) => ({ id: `b-${n}`, name: n, url: asset(`images/${n}.jpg`), kind: 'image' as MediaKind }))
  .concat(['hero', 'mentorship', 'integrating', 'graphics'].map((n) => ({ id: `b-${n}`, name: n, url: asset(`images/${n}.png`), kind: 'image' as MediaKind })));

export const kindOfItem = (m: Pick<MediaItem, 'kind' | 'contentType'>): MediaKind => m.kind ?? (m.contentType ? kindOf(m.contentType) ?? 'document' : 'image');

/** Preview tile for any kind of media (image, audio, video, document). */
export function MediaPreview({ item, className = 'aspect-square' }: { item: { name: string; url: string; alt?: string; kind: MediaKind }; className?: string }) {
  if (item.kind === 'audio') return <div className={`grid ${className} place-items-center p-2`}><audio controls preload="none" src={item.url} className="w-full" /></div>;
  if (item.kind === 'video') return <video controls preload="metadata" src={item.url} className={`${className} w-full bg-black object-cover`} />;
  if (item.kind === 'document' || item.kind === 'link') return <a href={item.url} target="_blank" rel="noopener noreferrer" className={`grid ${className} place-items-center gap-1 bg-cream text-sm font-medium text-forest-700`}><span className="grid place-items-center gap-1">{item.kind === 'link' ? <Link2 className="h-6 w-6" /> : <FileText className="h-6 w-6" />}Open</span></a>;
  return <img src={item.url} alt={item.alt || item.name} loading="lazy" className={`${className} w-full object-cover`} />;
}

/**
 * The one reusable media picker. Pick from the library (with search and type filter) or upload a new file.
 * `kinds` restricts what can be chosen (e.g. ['image'] for a photo field, ['audio','video'] for lesson media).
 */
export function MediaPickerDialog({ open, onClose, onPick, kinds, title = 'Choose from the media library', includeBundled }: {
  open: boolean; onClose: () => void; onPick: (m: PickedMedia) => void; kinds?: FileKind[]; title?: string; includeBundled?: boolean;
}) {
  const toast = useToast();
  const { data, loading } = useCollection<MediaItem>(C.media, () => (open ? [] : null), open ? 'open' : 'closed');
  const [tab, setTab] = useState<'library' | 'upload'>('library');
  const [q, setQ] = useState(''); const [kind, setKind] = useState<MediaKind | ''>('');
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowed = (k: MediaKind) => !kinds || (k !== 'link' && kinds.includes(k as FileKind));

  const items = useMemo(() => {
    const lib = data.map((m) => ({ id: m.id, name: m.name, url: m.url, kind: kindOfItem(m), contentType: m.contentType, size: m.size, alt: m.alt, tags: m.tags ?? [], folder: m.folder ?? '' }));
    const bundled = includeBundled === false || (kinds && !kinds.includes('image')) ? [] : BUNDLED.map((b) => ({ ...b, contentType: undefined, size: undefined, alt: '', tags: [] as string[], folder: 'Website images' }));
    const s = q.trim().toLowerCase();
    return [...lib, ...bundled].filter((m) => allowed(m.kind) && (!kind || m.kind === kind) && (!s || `${m.name} ${m.tags.join(' ')} ${m.folder}`.toLowerCase().includes(s)));
  }, [data, q, kind, kinds, includeBundled]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (f?: File) => {
    if (!f) return;
    const problem = validateUpload(f, kinds && kinds.length === 1 && kinds[0] === 'image' ? { imagesOnly: true } : {});
    if (problem) return toast.error(problem);
    const k = kindOf(f.type);
    if (!k || !allowed(k)) return toast.error(`That file type is not allowed here${kinds ? ` (allowed: ${kinds.join(', ')})` : ''}.`);
    try { setProgress(0); const r = await uploadToMedia(f, setProgress); toast.success('Uploaded'); onPick({ id: r.id, name: r.name, url: r.url, kind: r.kind, contentType: r.contentType, size: f.size }); onClose(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setProgress(null); }
  };

  return (
    <Dialog open={open} onClose={onClose} title={title} description={kinds ? `Allowed: ${kinds.join(', ')}` : 'Images, audio, video and documents'} size="xl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Tabs tabs={[{ id: 'library', label: 'Library' }, ...(flags.uploads ? [{ id: 'upload' as const, label: 'Upload new' }] : [])]} value={tab} onChange={setTab} />
      </div>
      {tab === 'upload' ? (
        <div className="space-y-2 text-sm">
          <Button loading={progress !== null} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Choose a file to upload</Button>
          <input ref={fileRef} type="file" hidden accept={kinds && kinds.length === 1 && kinds[0] === 'image' ? 'image/jpeg,image/png,image/webp,image/gif' : ACCEPT_ALL} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
          {progress !== null && <p className="text-xs text-muted">Uploading… {progress}%</p>}
          <p className="text-xs text-muted">Files added here go to the public media library, so anyone with the link can open them. For private study materials use the Resources centre.</p>
        </div>
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_180px]">
            <Input aria-label="Search the library" placeholder="Search by name, tag or folder" value={q} onChange={(e) => setQ(e.target.value)} />
            {(!kinds || kinds.length > 1) && <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value as MediaKind | '')}><option value="">All types</option>{(kinds ?? (['image', 'audio', 'video', 'document'] as FileKind[])).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>}
          </div>
          {loading && <p className="text-sm text-muted">Loading…</p>}
          {!loading && items.length === 0 && <p className="text-sm text-muted">Nothing matches. {flags.uploads ? 'Use "Upload new" to add a file.' : ''}</p>}
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 md:grid-cols-4">
            {items.map((m) => (
              <div key={m.id} className="overflow-hidden rounded-md border border-line">
                <MediaPreview item={m} className="aspect-[4/3]" />
                <div className="flex items-center justify-between gap-1 p-2"><span className="truncate text-xs" title={m.name}>{m.name}</span>
                  <Button size="sm" onClick={() => { onPick({ id: m.id, name: m.name, url: m.url, kind: m.kind, contentType: m.contentType, size: m.size }); onClose(); }}>Use</Button></div>
              </div>))}
          </div>
        </>)}
    </Dialog>
  );
}
