import { useRef, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { useToast } from '@/components/ui/overlay';
import { flags } from '@/config/env';
import { UPLOADS_OFF_MESSAGE } from '@/services/files';
import { MediaPickerDialog } from './MediaPickerDialog';
import { ACCEPT_IMAGES, imagePurposeFor, uploadPublicImage } from '@/services/storage';
import { useAuth } from '@/features/auth/AuthContext';
import { precheck } from '@/lib/filePolicy';
import { errorMessage } from '@/lib/utils';

/** Image picker (library images + bundled website images). Kept for existing callers; built on MediaPickerDialog. */
export function MediaPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  return <MediaPickerDialog open={open} onClose={onClose} kinds={['image']} title="Choose an image" onPick={(m) => onPick(m.url)} />;
}

/** Image input: paste a URL, pick from the media library, or upload (when Storage is enabled). */
export function ImageField({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const [picker, setPicker] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { roles } = useAuth();

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!flags.uploads) return toast.error(UPLOADS_OFF_MESSAGE);
    const problem = precheck(imagePurposeFor(roles), roles, file);
    if (problem) return toast.error(problem);
    try {
      setProgress(0);
      const ref = await uploadPublicImage(file, roles, setProgress);
      onChange(ref.url ?? '');
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
        {flags.uploads && (
          <>
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={progress !== null} aria-label="Upload image"><Upload className="h-4 w-4" /></Button>
            <input ref={fileRef} type="file" accept={ACCEPT_IMAGES} hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
      </div>
      {progress !== null && <p className="text-xs text-muted">Uploading… {progress}%</p>}
      {value && <img src={value} alt="" className="h-24 rounded-md border border-line object-cover" />}
      <MediaPicker open={picker} onClose={() => setPicker(false)} onPick={onChange} />
    </div>
  );
}
