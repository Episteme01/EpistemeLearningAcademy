import { getDownloadURL, ref, uploadBytesResumable, deleteObject } from 'firebase/storage';
import { auth, storage } from '@/config/firebase';
import { flags } from '@/config/env';
import { createDoc } from './db';
import { C } from '@/config/collections';

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-(excel|powerpoint)))$/;

export function validateUpload(file: File, opts: { imagesOnly?: boolean; maxBytes?: number } = {}): string | null {
  if (!flags.storage) return 'File uploads are disabled (VITE_ENABLE_STORAGE=false). Paste an image URL instead.';
  if (opts.imagesOnly ? !/^image\/(jpeg|png|webp|gif)$/.test(file.type) : !ALLOWED.test(file.type)) {
    return opts.imagesOnly ? 'Only JPG, PNG, WebP or GIF images are allowed.' : 'This file type is not allowed.';
  }
  if (file.size > (opts.maxBytes ?? MAX_UPLOAD_BYTES)) return `File is too large (max ${Math.round((opts.maxBytes ?? MAX_UPLOAD_BYTES) / 1024 / 1024)} MB).`;
  return null;
}

const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);

export async function uploadFile(path: string, file: File, onProgress?: (pct: number) => void): Promise<{ url: string; path: string }> {
  if (!auth().currentUser) throw new Error('Sign in to upload files.');
  const full = `${path}/${Date.now()}_${safeName(file.name)}`;
  const task = uploadBytesResumable(ref(storage(), full), file, { contentType: file.type });
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress?.(Math.round((s.bytesTransferred / s.totalBytes) * 100)), reject, () => resolve());
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
