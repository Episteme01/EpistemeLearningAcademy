/** Where a stored file lives. Old records only have a plain URL; new ones have a FileRef. */
export type Provider = 'cloudinary' | 'supabase' | 'firebase' | 'link';
export interface FileRef {
  provider: Provider;
  /** public https URL (cloudinary / link / legacy firebase). Never present for private files. */
  url?: string;
  /** supabase bucket */
  bucket?: string;
  /** supabase object path, or cloudinary public_id */
  path?: string;
  resourceType?: 'image' | 'video' | 'raw';
  name?: string; contentType?: string; size?: number;
}

export const isPrivateRef = (r?: FileRef | null) => r?.provider === 'supabase';

/** Detects where an old plain URL points, so legacy records keep working. */
export function providerOfUrl(url: string): Provider {
  if (/^https:\/\/(firebasestorage\.googleapis\.com|[a-z0-9-]+\.firebasestorage\.app)\//i.test(url) || /\.appspot\.com\//i.test(url)) return 'firebase';
  if (/^https:\/\/res\.cloudinary\.com\//i.test(url)) return 'cloudinary';
  return 'link';
}

/** Prefers the new `ref`; falls back to a legacy URL string. */
export function refOf(ref: FileRef | null | undefined, legacyUrl?: string): FileRef | null {
  if (ref && (ref.provider === 'supabase' ? ref.path : ref.url)) return ref;
  return legacyUrl ? { provider: providerOfUrl(legacyUrl), url: legacyUrl } : null;
}

/** Public URL if there is one (private Supabase files have none: they need a signed link). */
export const publicUrl = (r?: FileRef | null) => (r && r.provider !== 'supabase' ? r.url ?? null : null);
