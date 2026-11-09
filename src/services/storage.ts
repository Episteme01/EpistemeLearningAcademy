import { createDoc } from './db';
import { auth } from '@/config/firebase';
import { C } from '@/config/collections';
import { deleteFileRef, uploadFor, type Roles } from './files';
import { kindOfType, type Kind } from '@/lib/filePolicy';
import type { FileRef } from '@/lib/fileRef';
import type { MediaKind } from '@/types/models';

/**
 * File storage now lives outside Firebase (see docs/PHASE4B_FILE_STORAGE.md):
 *   public images / media  -> Cloudinary (signed uploads)
 *   private files          -> Supabase Storage (private buckets, signed links)
 * Uploads are signed by the "files" Edge Function; no secret is in this app.
 */
export type FileKind = Kind;
export const kindOf = (type: string): FileKind | null => kindOfType(type);
export const ACCEPT_IMAGES = 'image/jpeg,image/png,image/webp,image/gif';
export const ACCEPT_ALL = `${ACCEPT_IMAGES},audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx`;

const CMS = ['super_admin', 'admin', 'cms_editor', 'cms_author'];
/** Staff with a CMS role publish to the website folder; other staff (teachers) use the staff folder. */
export const imagePurposeFor = (roles: Roles) => (roles.some((r) => CMS.includes(r)) ? 'site_image' : 'staff_image') as 'site_image' | 'staff_image';

/** Upload a picture for a form field (page image, logo, course thumbnail, question image). Returns its public https URL. */
export async function uploadPublicImage(file: File, roles: Roles, onProgress?: (pct: number) => void): Promise<FileRef> {
  return uploadFor(imagePurposeFor(roles), file, roles, {}, onProgress);
}

/** Upload to the public media library (Cloudinary) and register it in Firestore (`media`). */
export async function uploadToMedia(file: File, roles: Roles, onProgress?: (pct: number) => void, alt = '', meta: { folder?: string; tags?: string[] } = {}) {
  const ref = await uploadFor('media_public', file, roles, {}, onProgress);
  const u = auth().currentUser;
  const kind: MediaKind = kindOf(file.type) ?? 'document';
  const id = await createDoc(C.media, {
    name: file.name, url: ref.url ?? '', path: ref.path ?? '', ref, provider: 'cloudinary', alt, contentType: file.type, kind, size: file.size, source: 'upload',
    folder: meta.folder ?? '', tags: meta.tags ?? [], uploadedBy: u?.uid ?? '', uploadedByName: u?.displayName ?? u?.email ?? '',
  });
  return { id, url: ref.url ?? '', kind, name: file.name, contentType: file.type };
}

/** Removes the stored file behind a library item (Cloudinary only; old Firebase or link items have nothing to remove). */
export const deleteMediaFile = (ref?: FileRef | null) => deleteFileRef(ref);
