// ELA file gateway: one small Supabase Edge Function (free plan).
//
// It is the ONLY thing that holds secrets (Cloudinary API secret, Supabase service key). The browser sends its Firebase
// login token; this function verifies it, decides what that person may do, then signs an upload or download.
// Deploy with JWT verification OFF (Firebase tokens are not Supabase tokens; we verify them ourselves below):
//   supabase functions deploy files --no-verify-jwt
//
// Secrets (Supabase dashboard > Edge Functions > Secrets), never in GitHub or the app:
//   FIREBASE_PROJECT_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, ALLOWED_ORIGINS (optional)
// Supabase injects SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY automatically.
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';
import { DOWNLOADS, PURPOSES, buildPath, canDeleteCloudinary, canDeleteSupabase, checkUpload, hasRole, pathAllowed, type DownloadCollection, type Purpose } from './policy.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const PROJECT = env('FIREBASE_PROJECT_ID');
const SB = env('SUPABASE_URL');
const SB_KEY = env('SUPABASE_SERVICE_ROLE_KEY');
const ORIGINS = (env('ALLOWED_ORIGINS') || 'https://episteme01.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? '';
  const ok = ORIGINS.includes(o) || /^http:\/\/localhost:\d+$/.test(o);
  return { 'Access-Control-Allow-Origin': ok ? o : ORIGINS[0]!, 'Access-Control-Allow-Headers': 'authorization, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

// Best-effort per-person throttle (resets when the function restarts).
const hits = new Map<string, { n: number; t: number }>();
function throttle(uid: string) {
  const now = Date.now(); const h = hits.get(uid);
  if (!h || now - h.t > 60_000) { hits.set(uid, { n: 1, t: now }); return; }
  if (++h.n > 60) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');
}

async function verify(req: Request): Promise<{ uid: string; token: string }> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
    if (!payload.sub) throw new Error('no sub');
    return { uid: payload.sub, token };
  } catch { throw new HttpError(401, 'Your session is not valid. Sign in again.'); }
}

type FsVal = { stringValue?: string; arrayValue?: { values?: FsVal[] }; mapValue?: { fields?: Record<string, FsVal> } };
/** Reads a Firestore document AS THE USER, so the existing Firestore security rules decide whether they may see it. */
async function readDoc(token: string, path: string): Promise<Record<string, FsVal> | null> {
  const r = await fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (r.status === 403 || r.status === 401) throw new HttpError(403, 'You do not have access to this file.');
  if (!r.ok) throw new HttpError(502, 'Could not check your access. Try again.');
  return ((await r.json()) as { fields?: Record<string, FsVal> }).fields ?? {};
}
const str = (v?: FsVal) => v?.stringValue ?? '';

async function profile(uid: string, token: string): Promise<{ roles: string[] }> {
  const f = await readDoc(token, `users/${uid}`);
  if (!f) throw new HttpError(403, 'No portal profile for this account.');
  if (str(f.status) !== 'active') throw new HttpError(403, 'This account is not active.');
  const roles = (f.roles?.arrayValue?.values ?? []).map((v) => v.stringValue ?? '').filter(Boolean);
  const primary = str(f.role); if (primary && !roles.includes(primary)) roles.push(primary);
  return { roles };
}

const sbHeaders = { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY, 'Content-Type': 'application/json' };
async function sbSignUpload(bucket: string, path: string): Promise<string> {
  const r = await fetch(`${SB}/storage/v1/object/upload/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST', headers: sbHeaders, body: '{}' });
  if (!r.ok) throw new HttpError(502, 'Storage is unavailable right now. Try again shortly.');
  const { url } = (await r.json()) as { url: string };
  return url.startsWith('http') ? url : `${SB}/storage/v1${url}`;
}
async function sbSignDownload(bucket: string, paths: string[], seconds: number): Promise<Record<string, string | null>> {
  const r = await fetch(`${SB}/storage/v1/object/sign/${bucket}`, { method: 'POST', headers: sbHeaders, body: JSON.stringify({ expiresIn: seconds, paths }) });
  if (!r.ok) throw new HttpError(502, 'Storage is unavailable right now. Try again shortly.');
  const rows = (await r.json()) as { path: string; signedURL: string | null }[];
  const out: Record<string, string | null> = {};
  for (const x of rows) out[x.path] = x.signedURL ? `${SB}/storage/v1${x.signedURL}` : null;
  return out;
}
async function sbRemove(bucket: string, path: string) {
  const r = await fetch(`${SB}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: sbHeaders, body: JSON.stringify({ prefixes: [path] }) });
  if (!r.ok) throw new HttpError(502, 'Could not delete the file.');
}

async function sha1(s: string) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const ALLOWED_FORMATS = 'jpg,jpeg,png,webp,gif,mp3,m4a,aac,wav,ogg,pdf,doc,docx,xls,xlsx,ppt,pptx,txt';

// deno-lint-ignore no-explicit-any
async function handle(req: Request, b: any): Promise<unknown> {
  const action = String(b.action ?? '');

  if (action === 'ping') {
    // Keeps the free Supabase project from being paused for inactivity (called by .github/workflows/keepalive.yml).
    await fetch(`${SB}/storage/v1/bucket`, { headers: sbHeaders });
    return { ok: true };
  }
  if (!PROJECT || !SB || !SB_KEY) throw new HttpError(500, 'The file service is not configured yet.');
  const { uid, token } = await verify(req);
  throttle(uid);
  const { roles } = await profile(uid, token);

  if (action === 'sign-upload') {
    const purpose = String(b.purpose) as Purpose;
    const type = String(b.contentType ?? ''); const size = Number(b.size); const name = String(b.fileName ?? 'file');
    const ctx = { studentId: b.studentId as string | undefined, assignmentId: b.assignmentId as string | undefined };
    const err = checkUpload(purpose, roles, type, size, ctx);
    if (err) throw new HttpError(400, err);
    const rule = PURPOSES[purpose];
    if (rule.provider === 'cloudinary') {
      const secret = env('CLOUDINARY_API_SECRET'); const cloud = env('CLOUDINARY_CLOUD_NAME'); const key = env('CLOUDINARY_API_KEY');
      if (!secret || !cloud || !key) throw new HttpError(500, 'Image uploads are not configured yet.');
      const timestamp = Math.floor(Date.now() / 1000);
      // Cloudinary signs the sorted "key=value" pairs plus the secret.
      const toSign = `allowed_formats=${ALLOWED_FORMATS}&folder=${rule.target}&timestamp=${timestamp}`;
      return { provider: 'cloudinary', cloudName: cloud, apiKey: key, timestamp, folder: rule.target, allowedFormats: ALLOWED_FORMATS, signature: await sha1(toSign + secret) };
    }
    const path = buildPath(purpose, uid, ctx, name, Date.now(), crypto.randomUUID().slice(0, 8));
    return { provider: 'supabase', bucket: rule.target, path, uploadUrl: await sbSignUpload(rule.target, path) };
  }

  if (action === 'sign-download' || action === 'sign-downloads') {
    const items: { collection: string; docId: string }[] = action === 'sign-download' ? [b] : Array.isArray(b.items) ? b.items.slice(0, 50) : [];
    const out: Record<string, string | null> = {};
    await Promise.all(items.map(async (it) => {
      const key = `${it.collection}/${it.docId}`;
      try {
        const d = (DOWNLOADS as Record<string, (typeof DOWNLOADS)[DownloadCollection] | undefined>)[it.collection];
        if (!d || !/^[A-Za-z0-9_-]{4,128}$/.test(it.docId)) { out[key] = null; return; }
        const f = await readDoc(token, `${it.collection}/${it.docId}`);        // Firestore rules decide here
        const ref = f?.[d.field]?.mapValue?.fields;
        if (!f || !ref || str(ref.provider) !== 'supabase') { out[key] = null; return; }
        const owner: Record<string, string> = { uid: str(f.uid), createdBy: str(f.createdBy) };
        const path = str(ref.path);
        if (!pathAllowed(it.collection, it.docId, path, owner)) { out[key] = null; return; }
        out[key] = (await sbSignDownload(d.bucket, [path], 300))[path] ?? null;
      } catch (e) { if (e instanceof HttpError && e.status === 403) out[key] = null; else throw e; }
    }));
    return action === 'sign-download' ? { url: Object.values(out)[0] ?? null } : { urls: out };
  }

  if (action === 'delete') {
    if (b.provider === 'supabase') {
      if (!canDeleteSupabase(String(b.bucket), String(b.path), uid, roles)) throw new HttpError(403, 'You cannot delete this file.');
      await sbRemove(String(b.bucket), String(b.path)); return { ok: true };
    }
    if (b.provider === 'cloudinary') {
      const id = String(b.path);
      if (!canDeleteCloudinary(id, roles)) throw new HttpError(403, 'You cannot delete this file.');
      const secret = env('CLOUDINARY_API_SECRET'); const timestamp = Math.floor(Date.now() / 1000);
      const rt = ['image', 'video', 'raw'].includes(String(b.resourceType)) ? String(b.resourceType) : 'image';
      const fd = new FormData(); fd.set('public_id', id); fd.set('timestamp', String(timestamp)); fd.set('api_key', env('CLOUDINARY_API_KEY'));
      fd.set('signature', await sha1(`public_id=${id}&timestamp=${timestamp}${secret}`));
      const r = await fetch(`https://api.cloudinary.com/v1_1/${env('CLOUDINARY_CLOUD_NAME')}/${rt}/destroy`, { method: 'POST', body: fd });
      if (!r.ok) throw new HttpError(502, 'Could not delete the image.');
      return { ok: true };
    }
    throw new HttpError(400, 'Unknown provider.');
  }
  void hasRole;
  throw new HttpError(400, 'Unknown action.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' });
  try { return json(req, 200, await handle(req, await req.json().catch(() => ({})))); }
  catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error(e); return json(req, 500, { error: 'Something went wrong.' });
  }
});
