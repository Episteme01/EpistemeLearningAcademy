import { auth } from '@/config/firebase';
import { filesGatewayUrl, flags } from '@/config/env';
import { PURPOSES, precheck, kindOfType, type Purpose } from '@/lib/filePolicy';
import { rolesOf } from '@/config/permissions';
import type { FileRef } from '@/lib/fileRef';

/**
 * Client for the ELA file gateway (Supabase Edge Function). Secrets never reach the browser:
 * the gateway signs uploads/downloads after checking the Firebase login and Firestore permissions.
 */
export const UPLOADS_OFF_MESSAGE = 'File uploads are not switched on yet. Set up the file service (see docs/PHASE4B_FILE_STORAGE.md) and add its URL in src/config/files.json.';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!flags.uploads) throw new Error(UPLOADS_OFF_MESSAGE);
  const u = auth().currentUser;
  if (!u) throw new Error('Sign in to continue.');
  let r: Response;
  try {
    r = await fetch(filesGatewayUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify(body) });
  } catch { throw new Error('Could not reach the file service. Check your connection.'); }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new Error(data.error || `File service error (${r.status}).`);
  return data;
}

/** Lets other services (e.g. password reset) call the same gateway. */
export const gatewayCall = call;

export interface UploadContext { studentId?: string; assignmentId?: string }
export type Roles = string[];

function xhrSend(method: 'POST' | 'PUT', url: string, body: FormData, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
    x.onerror = () => reject(new Error('Network error while uploading. Check your connection and try again.'));
    x.onload = () => (x.status >= 200 && x.status < 300 ? (onProgress?.(100), resolve(x.responseText)) : reject(new Error(x.status === 413 ? 'The file is too large.' : `Upload failed (${x.status}).`)));
    x.send(body);
  });
}

/**
 * Uploads one file for a purpose. Private purposes go to Supabase (returns a FileRef with no public URL);
 * public purposes go to Cloudinary (returns a FileRef with a public https URL).
 */
export async function uploadFor(purpose: Purpose, file: File, roles: Roles, ctx: UploadContext = {}, onProgress?: (pct: number) => void): Promise<FileRef> {
  const problem = precheck(purpose, roles, file);
  if (problem) throw new Error(problem);
  const kind = kindOfType(file.type)!;
  const signed = await call<
    | { provider: 'supabase'; bucket: string; path: string; uploadUrl: string }
    | { provider: 'cloudinary'; cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string }
  >({ action: 'sign-upload', purpose, fileName: file.name, contentType: file.type, size: file.size, ...ctx });

  const meta = { name: file.name, contentType: file.type, size: file.size };
  if (signed.provider === 'supabase') {
    const fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', file);
    await xhrSend('PUT', signed.uploadUrl, fd, onProgress);
    return { provider: 'supabase', bucket: signed.bucket, path: signed.path, ...meta };
  }
  const fd = new FormData();
  fd.append('file', file); fd.append('api_key', signed.apiKey); fd.append('timestamp', String(signed.timestamp));
  fd.append('signature', signed.signature); fd.append('folder', signed.folder); fd.append('allowed_formats', signed.allowedFormats);
  const resourceType = kind === 'image' ? 'image' : kind === 'audio' ? 'video' : 'raw';
  const text = await xhrSend('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(signed.cloudName)}/${resourceType}/upload`, fd, onProgress);
  const res = JSON.parse(text) as { secure_url?: string; public_id?: string };
  if (!res.secure_url || !res.public_id) throw new Error('The image service did not return a link. Try again.');
  return { provider: 'cloudinary', url: res.secure_url, path: res.public_id, resourceType, ...meta };
}

/** Deletes a stored file (owner or the right staff only; the gateway decides). Old Firebase / plain links are ignored. */
export async function deleteFileRef(ref?: FileRef | null): Promise<void> {
  if (!ref || (ref.provider !== 'supabase' && ref.provider !== 'cloudinary') || !ref.path) return;
  await call({ action: 'delete', provider: ref.provider, bucket: ref.bucket, path: ref.path, resourceType: ref.resourceType });
}

/* ------------------------------------------------------------------ signed downloads (private files) */
export type PrivateCollection = 'students' | 'users' | 'submissions' | 'resources';
const cache = new Map<string, { url: string | null; exp: number }>();
const TTL = 4 * 60_000;
let queue: { key: string; collection: PrivateCollection; docId: string; res: (u: string | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = queue; queue = []; timer = null;
  const uniq = [...new Map(batch.map((b) => [b.key, b])).values()];
  try {
    const { urls } = await call<{ urls: Record<string, string | null> }>({ action: 'sign-downloads', items: uniq.map((u) => ({ collection: u.collection, docId: u.docId })) });
    for (const u of uniq) cache.set(u.key, { url: urls[u.key] ?? null, exp: Date.now() + TTL });
    for (const b of batch) b.res(urls[b.key] ?? null);
  } catch { for (const b of batch) b.res(null); }
}

/** Short-lived link for a private file, authorised by the Firestore document that references it. Batched and cached. */
export function signedUrlFor(collection: PrivateCollection, docId: string): Promise<string | null> {
  const key = `${collection}/${docId}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  return new Promise((res) => {
    queue.push({ key, collection, docId, res });
    if (queue.length >= 50) { if (timer) clearTimeout(timer); void flush(); } else if (!timer) timer = setTimeout(() => void flush(), 40);
  });
}
/** Forget a cached link (call after replacing a file). */
export const forgetSignedUrl = (collection: PrivateCollection, docId: string) => cache.delete(`${collection}/${docId}`);
export const rolesFor = (p: Parameters<typeof rolesOf>[0]): Roles => rolesOf(p);
export { PURPOSES };
