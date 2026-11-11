// ELA Paystack payments: a Supabase Edge Function (free plan). The Paystack SECRET key lives only in Supabase secrets.
//
// Flow: parent taps "Pay online" -> action 'initialize' -> Paystack checkout -> back to the site -> action 'verify'.
// Paystack also calls this function's webhook, so a payment is recorded even if the parent closes the page.
// A payment is recorded only after the server asks Paystack "was this really paid, and for how much?".
//
// Deploy: name it exactly `paystack`, Verify JWT OFF (the code checks Firebase tokens / Paystack's signature itself).
// Secrets: PAYSTACK_SECRET_KEY (sk_test_... first, sk_live_... when ready), FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT,
//          SITE_URL, ALLOWED_ORIGINS, MAIL_FROM_EMAIL (used only when a payer has no usable email)
// Paystack dashboard > Settings > API Keys & Webhooks > Webhook URL: https://<project-ref>.supabase.co/functions/v1/paystack
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'npm:jose@5';

const env = (k: string) => Deno.env.get(k) ?? '';
const PROJECT = env('FIREBASE_PROJECT_ID');
const SITE = (env('SITE_URL') || 'https://episteme01.github.io/epistemelearningacademy').replace(/\/+$/, '');
const ORIGINS = (env('ALLOWED_ORIGINS') || 'https://episteme01.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const FS_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const chunk = <T,>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
function cors(req: Request) {
  const o = req.headers.get('origin') ?? '';
  const ok = ORIGINS.includes(o) || /^http:\/\/localhost:\d+$/.test(o);
  return { 'Access-Control-Allow-Origin': ok ? o : ORIGINS[0]!, 'Access-Control-Allow-Headers': 'authorization, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

/* ------------------------------------------------------------------ Firestore (admin) */
let cached: { token: string; exp: number } | null = null;
async function adminToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  let sa: { client_email?: string; private_key?: string };
  try { sa = JSON.parse(env('FIREBASE_SERVICE_ACCOUNT')); } catch { throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT is missing or not valid JSON.'); }
  if (!sa.client_email || !sa.private_key) throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT is missing client_email or private_key.');
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('55m').sign(key);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!r.ok) throw new HttpError(502, 'Could not sign in to Firebase with the service account.');
  const j = (await r.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}
const H = async (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${await adminToken()}`, 'Content-Type': 'application/json', ...extra });

// plain JS <-> Firestore value encoding
// deno-lint-ignore no-explicit-any
type Fs = any;
function toFs(v: unknown): Fs {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, toFs(x)])) } };
}
function fromFs(v: Fs): unknown {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(fromFs);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, fromFs(x)]));
  return null;
}
type Doc = Record<string, unknown> & { id: string };
const decode = (d: { name: string; fields?: Record<string, Fs> }): Doc => ({ id: d.name.split('/').pop()!, ...(Object.fromEntries(Object.entries(d.fields ?? {}).map(([k, x]) => [k, fromFs(x)])) as Record<string, unknown>) });

async function query(collection: string, where: { field: string; op: string; value: unknown }[], limit = 1000): Promise<Doc[]> {
  const filters = where.map((w) => ({ fieldFilter: { field: { fieldPath: w.field }, op: w.op, value: toFs(w.value) } }));
  const structuredQuery: Record<string, unknown> = { from: [{ collectionId: collection }], limit };
  if (filters.length === 1) structuredQuery.where = filters[0]; else if (filters.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters } };
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: await H(), body: JSON.stringify({ structuredQuery }) });
  if (!r.ok) throw new HttpError(502, `Firestore query failed (${collection}).`);
  return ((await r.json()) as { document?: { name: string; fields?: Record<string, Fs> } }[]).filter((x) => x.document).map((x) => decode(x.document!));
}
async function getDoc(path: string): Promise<Doc | null> {
  const r = await fetch(`${FS}/${path}`, { headers: await H() });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, `Firestore read failed (${path}).`);
  return decode((await r.json()) as { name: string; fields?: Record<string, Fs> });
}
/** Creates the document only if it does not exist yet. Returns false when it already existed (used for de-duplication). */
async function createOnce(collection: string, id: string, data: Record<string, unknown>): Promise<boolean> {
  const r = await fetch(`${FS}/${collection}?documentId=${encodeURIComponent(id)}`, { method: 'POST', headers: await H(), body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFs(v)])) }) });
  if (r.status === 409) return false;
  if (!r.ok) throw new HttpError(502, `Firestore write failed (${collection}).`);
  return true;
}
async function patch(path: string, data: Record<string, unknown>) {
  const mask = Object.keys(data).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const r = await fetch(`${FS}/${path}?${mask}`, { method: 'PATCH', headers: await H(), body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, toFs(v)])) }) });
  if (!r.ok) throw new HttpError(502, `Firestore update failed (${path}).`);
}
async function remove(path: string) { await fetch(`${FS}/${path}`, { method: 'DELETE', headers: await H() }); }
async function addInApp(rows: { uid: string; title: string; body: string; link: string }[]) {
  for (const part of chunk(rows, 200)) {
    const writes = part.map((n) => ({
      update: { name: `${FS_ROOT}/notifications/${crypto.randomUUID().replace(/-/g, '')}`, fields: Object.fromEntries(Object.entries({ userUid: n.uid, title: n.title, body: n.body, link: n.link, read: false }).map(([k, v]) => [k, toFs(v)])) },
      updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }],
    }));
    const r = await fetch(`${FS}:commit`, { method: 'POST', headers: await H(), body: JSON.stringify({ writes }) });
    if (!r.ok) throw new HttpError(502, 'Could not save in-app notifications.');
  }
}


/* ------------------------------------------------------------------ extras */
async function rawDoc(path: string): Promise<{ doc: Doc; updateTime: string } | null> {
  const r = await fetch(`${FS}/${path}`, { headers: await H() });
  if (r.status === 404) return null;
  if (!r.ok) throw new HttpError(502, `Firestore read failed (${path}).`);
  const j = (await r.json()) as { name: string; fields?: Record<string, Fs>; updateTime: string };
  return { doc: decode(j), updateTime: j.updateTime };
}
const fieldsOf = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toFs(v)]));
const lagosDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(d);   // YYYY-MM-DD
const round2 = (n: number) => Math.round(n * 100) / 100;
const MIN_PAY = 100;   // NGN

async function paystack(path: string, init?: RequestInit) {
  const key = env('PAYSTACK_SECRET_KEY');
  if (!key) throw new HttpError(500, 'Online payment is not set up yet (PAYSTACK_SECRET_KEY).');
  const r = await fetch(`https://api.paystack.co${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: Record<string, unknown> };
  if (!r.ok || !j.status) throw new HttpError(502, `Paystack: ${j.message ?? r.status}`);
  return j.data ?? {};
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const timingSafe = (a: string, b: string) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

async function verifyUser(req: Request): Promise<{ uid: string; token: string }> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
    if (!payload.sub) throw new Error('no sub');
    return { uid: payload.sub, token };
  } catch { throw new HttpError(401, 'Your session is not valid. Sign in again.'); }
}
/** Reads a document AS THE SIGNED-IN USER, so the Firestore rules decide whether they may see this invoice. */
async function readAsUser(path: string, token: string): Promise<Doc | null> {
  const r = await fetch(`${FS}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404 || r.status === 403) return null;
  if (!r.ok) throw new HttpError(502, 'Could not read the invoice.');
  return decode((await r.json()) as { name: string; fields?: Record<string, Fs> });
}
const validEmail = (e: unknown) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && !/\.(invalid|local|internal)$/i.test(e);

/* ------------------------------------------------------------------ initialize */
async function initialize(uid: string, token: string, b: { invoiceId?: string; amount?: number }) {
  const invoiceId = String(b.invoiceId ?? '');
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(invoiceId)) throw new HttpError(400, 'Invalid invoice.');
  const inv = await readAsUser(`invoices/${invoiceId}`, token);
  if (!inv) throw new HttpError(403, 'You cannot pay this invoice.');
  if (inv.status === 'cancelled') throw new HttpError(400, 'This invoice was cancelled.');
  const total = Number(inv.total); const paid = Number(inv.paid ?? 0); const balance = round2(total - paid);
  if (!(balance > 0)) throw new HttpError(400, 'This invoice is already fully paid.');
  const currency = String(inv.currency || 'NGN').toUpperCase();
  if (currency !== 'NGN') throw new HttpError(400, 'Online payment supports NGN invoices only.');
  const amount = b.amount === undefined ? balance : round2(Number(b.amount));
  if (!Number.isFinite(amount) || amount < Math.min(MIN_PAY, balance)) throw new HttpError(400, `The smallest payment is NGN ${Math.min(MIN_PAY, balance)}.`);
  if (amount > balance + 0.0001) throw new HttpError(400, 'That is more than the outstanding balance.');

  const user = await getDoc(`users/${uid}`);
  const email = validEmail(user?.email) && !user?.username ? String(user?.email) : (env('MAIL_FROM_EMAIL') || '');
  if (!validEmail(email)) throw new HttpError(400, 'No email address is available for the receipt. Add an email to your profile.');

  const reference = `ELA${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  const kobo = Math.round(amount * 100);
  await createOnce('paystackTx', reference, { reference, invoiceId, amountKobo: kobo, amount, currency, uid, status: 'pending', createdAt: new Date() });
  const data = await paystack('/transaction/initialize', { method: 'POST', body: JSON.stringify({
    email, amount: kobo, currency, reference, callback_url: `${SITE}/`,
    metadata: { invoiceId, invoiceNo: inv.invoiceNo, studentName: inv.studentName, custom_fields: [{ display_name: 'Student', variable_name: 'student', value: String(inv.studentName ?? '') }, { display_name: 'Invoice', variable_name: 'invoice', value: String(inv.invoiceNo ?? '') }] },
  }) });
  return { authorizationUrl: String(data.authorization_url), reference };
}

/* ------------------------------------------------------------------ record (idempotent) */
async function record(reference: string): Promise<{ status: 'success' | 'pending' | 'failed'; receiptNo?: string; amount?: number }> {
  if (!/^[A-Za-z0-9]{6,60}$/.test(reference)) throw new HttpError(400, 'Invalid reference.');
  for (let attempt = 0; attempt < 3; attempt++) {
    const tx = await rawDoc(`paystackTx/${reference}`);
    if (!tx) throw new HttpError(404, 'Unknown payment reference.');
    const t = tx.doc;
    if (t.status === 'applied') return { status: 'success', receiptNo: String(t.receiptNo), amount: Number(t.amount) };

    const v = await paystack(`/transaction/verify/${reference}`);
    const st = String(v.status);
    if (st !== 'success') return { status: st === 'failed' || st === 'abandoned' || st === 'reversed' ? 'failed' : 'pending' };
    if (Number(v.amount) !== Number(t.amountKobo) || String(v.currency).toUpperCase() !== String(t.currency)) {
      await patch(`paystackTx/${reference}`, { status: 'mismatch', paidKobo: Number(v.amount) });
      throw new HttpError(409, 'The amount paid does not match the request. Contact the school office with reference ' + reference + '.');
    }
    const invRaw = await rawDoc(`invoices/${t.invoiceId}`);
    if (!invRaw) throw new HttpError(404, 'The invoice no longer exists. Contact the school office with reference ' + reference + '.');
    const inv = invRaw.doc; const amount = Number(t.amount);
    const paid = round2(Number(inv.paid ?? 0) + amount); const total = Number(inv.total);
    const balance = Math.max(0, round2(total - paid));
    const status = balance <= 0 ? 'paid' : (inv.dueDate && new Date(String(inv.dueDate) + 'T23:59:59') < new Date() ? 'overdue' : 'partial');
    const receiptNo = `PS-${reference.slice(-10)}`;
    const payId = `PS${reference}`;
    const now = 'REQUEST_TIME';
    const writes = [
      { update: { name: `${FS_ROOT}/payments/${payId}`, fields: fieldsOf({ receiptNo, invoiceId: String(t.invoiceId), invoiceNo: String(inv.invoiceNo ?? ''), studentId: String(inv.studentId ?? ''), studentName: String(inv.studentName ?? ''), studentUid: String(inv.studentUid ?? ''), parentUids: (inv.parentUids as string[]) ?? [], amount, method: 'online', reference, paidAt: lagosDate(), recordedBy: 'Paystack (online)', currency: String(t.currency), gateway: { provider: 'paystack', status: 'success' } }) }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: now }, { fieldPath: 'updatedAt', setToServerValue: now }] },
      { update: { name: `${FS_ROOT}/invoices/${t.invoiceId}`, fields: fieldsOf({ paid, balance, status }) }, updateMask: { fieldPaths: ['paid', 'balance', 'status'] }, currentDocument: { updateTime: invRaw.updateTime }, updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: now }] },
      { update: { name: `${FS_ROOT}/paystackTx/${reference}`, fields: fieldsOf({ status: 'applied', receiptNo }) }, updateMask: { fieldPaths: ['status', 'receiptNo'] }, currentDocument: { updateTime: tx.updateTime }, updateTransforms: [{ fieldPath: 'appliedAt', setToServerValue: now }] },
    ];
    const r = await fetch(`${FS}:commit`, { method: 'POST', headers: await H(), body: JSON.stringify({ writes }) });
    if (r.ok) {
      const people = [...new Set([...(((inv.parentUids as string[]) ?? [])), String(inv.studentUid ?? ''), String(t.uid ?? '')].filter(Boolean))];
      await addInApp(people.map((uid) => ({ uid, title: `Payment received (${receiptNo})`, body: `NGN ${amount.toLocaleString('en-NG')} for ${String(inv.studentName ?? '')}`, link: '/app/ems/children' }))).catch(() => undefined);
      return { status: 'success', receiptNo, amount };
    }
    // another request (webhook vs. the parent's page) got there first: loop, and the 'applied' check returns the receipt
    if (r.status !== 409 && r.status !== 400) throw new HttpError(502, 'Could not save the payment. It will be retried automatically.');
  }
  throw new HttpError(502, 'Could not confirm the payment yet. Refresh in a minute.');
}

/* ------------------------------------------------------------------ routing */
// deno-lint-ignore no-explicit-any
async function handle(req: Request): Promise<unknown> {
  if (!PROJECT) throw new HttpError(500, 'Not configured (FIREBASE_PROJECT_ID).');
  const sig = req.headers.get('x-paystack-signature');
  if (sig) {                                              // Paystack webhook
    const raw = await req.text();
    const secret = env('PAYSTACK_SECRET_KEY');
    if (!secret || !timingSafe(await hmacHex(secret, raw), sig)) throw new HttpError(401, 'Bad signature.');
    const ev = JSON.parse(raw) as { event?: string; data?: { reference?: string } };
    if (ev.event === 'charge.success' && ev.data?.reference) { try { await record(ev.data.reference); } catch (e) { console.error('webhook record failed', e); if (e instanceof HttpError && e.status >= 500) throw e; } }
    return { ok: true };
  }
  const b = (await req.json().catch(() => ({}))) as { action?: string; invoiceId?: string; amount?: number; reference?: string };
  const { uid, token } = await verifyUser(req);
  if (b.action === 'initialize') return initialize(uid, token, b);
  if (b.action === 'verify') {
    const tx = await getDoc(`paystackTx/${String(b.reference ?? '')}`);
    if (!tx) throw new HttpError(404, 'Unknown payment reference.');
    const roles = ((await getDoc(`users/${uid}`))?.roles as string[]) ?? [];
    if (tx.uid !== uid && !roles.some((r) => ['super_admin', 'admin', 'finance'].includes(r))) throw new HttpError(403, 'Not your payment.');
    return record(String(b.reference));
  }
  throw new HttpError(400, 'Unknown action.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' });
  try { return json(req, 200, await handle(req)); }
  catch (e) {
    if (e instanceof HttpError) return json(req, e.status, { error: e.message });
    console.error(e); return json(req, 500, { error: 'Something went wrong.' });
  }
});
