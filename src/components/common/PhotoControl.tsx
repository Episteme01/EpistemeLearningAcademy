import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/overlay';
import { SecureAvatar } from './SecureAvatar';
import { useAuth } from '@/features/auth/AuthContext';
import { patchDoc } from '@/services/db';
import { UPLOADS_OFF_MESSAGE, deleteFileRef, forgetSignedUrl, uploadFor } from '@/services/files';
import { ACCEPT_IMAGES } from '@/services/storage';
import { flags } from '@/config/env';
import { precheck } from '@/lib/filePolicy';
import { errorMessage } from '@/lib/utils';
import type { FileRef } from '@/lib/fileRef';

/**
 * Uploads a person's photograph PRIVATELY (Supabase) and saves the reference on their record.
 * `students` = a student's photo, set by admissions/admin/principal. `users` = your own profile picture.
 * The picture is only shown to people allowed to read that record, through a short-lived link.
 */
export function PhotoControl({ collection, docId, name, current, legacyUrl }: {
  collection: 'students' | 'users'; docId?: string; name: string; current?: FileRef | null; legacyUrl?: string;
}) {
  const toast = useToast();
  const { roles } = useAuth();
  const [ref, setRef] = useState<FileRef | null>(current ?? null);
  const [pct, setPct] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const purpose = collection === 'students' ? 'student_photo' : 'avatar';

  if (!docId) return <p className="text-sm text-muted">Save the record first, then edit it to add a photograph.</p>;

  const onFile = async (file?: File) => {
    if (!file) return;
    if (!flags.uploads) return toast.error(UPLOADS_OFF_MESSAGE);
    const problem = precheck(purpose, roles, file); if (problem) return toast.error(problem);
    try {
      setPct(0);
      const next = await uploadFor(purpose, file, roles, collection === 'students' ? { studentId: docId } : {}, setPct);
      await patchDoc(collection, docId, { photoRef: next });
      const old = ref; setRef(next); forgetSignedUrl(collection, docId);
      if (old?.provider === 'supabase') void deleteFileRef(old).catch(() => undefined);   // remove the replaced photo
      toast.success('Photograph saved');
    } catch (e) { toast.error(errorMessage(e)); } finally { setPct(null); }
  };
  const remove = async () => {
    try {
      await patchDoc(collection, docId, { photoRef: null }); const old = ref; setRef(null); forgetSignedUrl(collection, docId);
      if (old?.provider === 'supabase') void deleteFileRef(old).catch(() => undefined);
      toast.success('Photograph removed');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="flex items-center gap-3">
      <SecureAvatar name={name} collection={collection} docId={docId} photoRef={ref} legacyUrl={legacyUrl} size={64} />
      <div className="space-y-1">
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" loading={pct !== null} onClick={() => input.current?.click()}><Camera className="h-4 w-4" /> {ref ? 'Change photo' : 'Add photo'}</Button>
          {ref && <Button type="button" size="sm" variant="outline" onClick={() => void remove()}><Trash2 className="h-4 w-4 text-danger" /> Remove</Button>}
          <input ref={input} type="file" hidden accept={ACCEPT_IMAGES} onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <p className="text-xs text-muted">{pct !== null ? `Uploading… ${pct}%` : 'Private. JPG, PNG or WebP, up to 2 MB.'}</p>
      </div>
    </div>
  );
}
