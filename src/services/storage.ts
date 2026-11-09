import { getDownloadURL, ref, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { auth, storage } from '@/config/firebase';
import { flags } from '@/config/env';
import { createDoc } from './db';
import { C } from '@/config/collections';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const AUDIO = /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|wav|x-wav|ogg|webm)$/;
const VIDEO = /^video\/(mp4|webm|quicktime)$/;
const DOC = /^(application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-(excel|powerpoint)))$/;

export type FileKind = 'image' | 'audio' | 'video' | 'document';
export const kindOf = (type: string): FileKind | null => IMAGE.test(type) ? 'image' : AUDIO.test(type) ? 'audio' : VIDEO.test(type) ? 'video' : DOC.test(type) ? 'document' : null;
/** Size limits per kind (also enforced by firebase/storage.rules). */
export const LIMITS: Record<FileKind, number> = { image: 10 * 1024 * 1024, document: 25 * 1024 * 1024, audio: 50 * 1024 * 1024, video: 100 * 1024 * 1024 };
export const ACCEPT_ALL = 'image/jpeg,image/png,image/webp,image/gif,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,video/mp4,video/webm,video/quicktime,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

export function validateUpload(file: File, opts: { imagesOnly?: boolean; maxBytes?: number } = {}): string | null {
  if (!flags.storage) return 'File uploads are turned off. Cloud Storage needs the Firebase Blaze plan — see the README, then set "storage": true in src/config/features.json.';
  const kind = kindOf(file.type);
  if (!kind || (opts.imagesOnly && kind !== 'image')) return opts.imagesOnly ? 'Only JPG, PNG, WebP or GIF images are allowed here.' : 'This file type is not allowed. Use images, audio (MP3/M4A/WAV), video (MP4/WebM), PDF, Word, Excel, PowerPoint or text.';
  const max = opts.maxBytes ?? LIMITS[kind];
  if (file.size > max) return `This ${kind} is too large (max ${Math.round(max / 1024 / 1024)} MB).`;
  return null;
}

/** Turns Firebase Storage failures into something a school administrator can act on. */
function friendlyStorageError(e: unknown): Error {
  const code = (e as { code?: string }).code ?? '';
  if (code === 'storage/unauthorized') return new Error('Upload refused. Your role may not be allowed to upload here, or the Storage rules have not been published (Firebase console → Storage → Rules).');
  if (code === 'storage/unauthenticated') return new Error('Please sign in again to upload.');
  if (code === 'storage/quota-exceeded' || code === 'storage/retry-limit-exceeded' || code === 'storage/unknown' || /402|403|billing|plan/i.test(String((e as Error).message))) {
    return new Error('Cloud Storage is not available for this Firebase project. Upgrade the project to the Blaze plan and open Build → Storage once to create the bucket (see README).');
  }
  if (code === 'storage/canceled') return new Error('Upload cancelled.');
  return e instanceof Error ? e : new Error('Upload failed.');
}

const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

export async function uploadFile(path: string, file: File, onProgress?: (pct: number) => void): Promise<{ url: string; path: string }> {
  if (!auth().currentUser) throw new Error('Sign in to upload files.');
  const full = `${path}/${Date.now()}_${safeName(file.name)}`;
  const task = uploadBytesResumable(ref(storage(), full), file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), (e) => reject(friendlyStorageError(e)), () => resolve());
  });
  return { url: await getDownloadURL(task.snapshot.ref), path: full };
}

/** Upload to the public media library and register it in Firestore (`media`). */
export async function uploadToMedia(file: File, onProgress?: (pct: number) => void, alt = '') {
  const { url, path } = await uploadFile('public/media', file, onProgress);
  const id = await createDoc(C.media, {
    name: file.name, url, path, alt, contentType: file.type, size: file.size, source: 'upload', uploadedBy: auth().currentUser?.uid ?? '',
  });
  return { id, url };
}

export async function deleteStored(path: string | undefined) {
  if (!path) return;
  try {
    await deleteObject(ref(storage(), path));
  } catch (e) {
    console.warn('storage delete failed', e);
  }
}
