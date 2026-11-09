import { useRef, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Dialog, useToast } from '@/components/ui/overlay';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { flags } from '@/config/env';
import { uploadToMedia, validateUpload } from '@/services/storage';
import { errorMessage } from '@/lib/utils';
import { asset } from '@/config/brand';

interface MediaDoc { name: string; url: string; alt?: string; contentType?: string }

/** Bundled images that ship with the site (always available, no Storage needed). */
const BUNDLED = ['classroom', 'founder', 'consultation', 'islamic-study', 'digital-hub', 'curriculum', 'skills', 'ielts', 'holistic', 'flexible', 'learning']
  .map((n) => ({ id: `b-${n}`, name: n, url: asset(`images/${n}.jpg`) }))
  .concat(['hero', 'mentorship', 'integrating', 'graphics'].map((n) => ({ id: `b-${n}`, name: n, url: asset(`images/${n}.png`) })));

export function MediaPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const { data, loading } = useCollection<MediaDoc>(C.media, () => [], 'all');
  return (
    <Dialog open={open} onClose={onClose} title="Choose an image" description="Media library and bundled website images" size="xl">
      {loading ? <p className="text-sm text-muted">Loading…</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {[...data.filter((m) => !m.contentType || m.contentType.startsWith('image/')).map((m) => ({ id: m.id, name: m.name, url: m.url })), ...BUNDLED].map((m) => (
          <button key={m.id} type="button" onClick={() => { onPick(m.url); onClose(); }}
            className="group overflow-hidden rounded-md border border-line text-left hover:border-gold-400 focus-visible:border-gold-400">
            <img src={m.url} alt={m.name} loading="lazy" className="aspect-[4/3] w-full object-cover" />
            <span className="block truncate px-2 py-1.5 text-xs text-muted group-hover:text-ink">{m.name}</span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}

/** Image input: paste a URL, pick from the media library, or upload (when Storage is enabled). */
export function ImageField({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const [picker, setPicker] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const onFile = async (file?: File) => {
    if (!file) return;
    const problem = validateUpload(file, { imagesOnly: true });
    if (problem) return toast.error(problem);
    try {
      setProgress(0);
      const { url } = await uploadToMedia(file, setProgress);
      onChange(url);
      toast.success('Image uploaded');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or choose from library" />
        <Button variant="outline" onClick={() => setPicker(true)} aria-label="Choose from library"><ImagePlus className="h-4 w-4" /></Button>
        {flags.storage && (
          <>
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={progress !== null} aria-label="Upload image"><Upload className="h-4 w-4" /></Button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
      </div>
      {progress !== null && <p className="text-xs text-muted">Uploading… {progress}%</p>}
      {value && <img src={value} alt="" className="h-24 rounded-md border border-line object-cover" />}
      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={onChange} />
    </div>
  );
}
