import { Avatar } from '@/components/ui/data';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import type { PrivateCollection } from '@/services/files';
import type { FileRef } from '@/lib/fileRef';

/**
 * Avatar for a person's photograph. New photographs are private (Supabase) and shown through a short-lived link;
 * old records that only have a plain `photoUrl` keep working unchanged.
 */
export function SecureAvatar({ name, collection, docId, photoRef, legacyUrl, size }: {
  name: string; collection: PrivateCollection; docId?: string; photoRef?: FileRef | null; legacyUrl?: string; size?: number;
}) {
  const priv = photoRef?.provider === 'supabase';
  const { url } = useSignedUrl(collection, docId, priv);
  const src = priv ? url ?? undefined : photoRef?.url || legacyUrl || undefined;
  return <Avatar name={name} src={src} size={size} />;
}
