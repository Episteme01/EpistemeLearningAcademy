// ELA record management: permanent deletion of staff, parents, students and invoices, done by a trusted backend.
// The browser can NOT delete these records any more (Firestore rules refuse it). Every deletion:
//   1. is allowed only for admin / super admin (finance can also delete invoices), checked against the users record,
//   2. is previewed first ("check"), then needs the typed word DELETE,
//   3. resolves dependencies (clears references, never leaves broken links),
//   4. keeps a restricted archive copy in `deletionArchive` (no client access) and an `auditLogs` entry,
//   5. optionally removes the login account (Firebase Authentication) through the Admin API.
// Deploy as a function named exactly `records`, Verify JWT OFF.
// Secrets used: FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT, ALLOWED_ORIGINS (and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, set automatically, to remove private photos).
import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'npm:jose@5';

const env = (k: string) => Deno.env.get(k) ?? '';
const PROJECT = env('FIREBASE_PROJECT_ID');
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


/* ------------------------------------------------------------------ helpers */
async function commit(writes: unknown[]) {
  for (const part of chunk(writes, 400)) {
    const r = await fetch(`${FS}:commit`, { method: 'POST', headers: await H(), body: JSON.stringify({ writes: part }) });
    if (!r.ok) throw new HttpError(502, 'A database write failed. Nothing further was changed; run the check again.');
  }
}
const docName = (path: string) => `${FS_ROOT}/${path}`;
const del = (path: string) => ({ delete: docName(path) });
const fieldsOf = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toFs(v)]));
const setFields = (path: string, o: Record<string, unknown>) => ({ update: { name: docName(path), fields: fieldsOf(o) }, updateMask: { fieldPaths: Object.keys(o) } });
const pullFromArray = (path: string, field: string, values: string[]) => ({ transform: { document: docName(path), fieldTransforms: [{ fieldPath: field, removeAllFromArray: { values: values.map(toFs) } }] } });
type Where = { field: string; op: string; value: unknown };
async function find(collection: string, where: Where[], limit = 1000) { return query(collection, where, limit); }
const EQ = (field: string, value: unknown): Where => ({ field, op: 'EQUAL', value });
const HAS = (field: string, value: unknown): Where => ({ field, op: 'ARRAY_CONTAINS', value });

async function verifyUser(req: Request): Promise<string> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
    if (!payload.sub) throw new Error('no sub');
    return payload.sub;
  } catch { throw new HttpError(401, 'Your session is not valid. Sign in again.'); }
}
async function actor(uid: string) {
  const u = await getDoc(`users/${uid}`);
  if (!u || u.status !== 'active') throw new HttpError(403, 'No active portal profile for this account.');
  const roles = ((u.roles as string[]) ?? []).slice(); if (u.role && !roles.includes(String(u.role))) roles.push(String(u.role));
  return { roles, name: String(u.displayName ?? u.email ?? uid) };
}

type Dep = { key: string; label: string; count: number; blocking?: boolean; note?: string };
interface Plan { kind: string; id: string; label: string; deps: Dep[]; loginUid: string; loginRole: string; hasLogin: boolean; loginNote: string; writes: unknown[]; archive: Record<string, unknown>; photo?: { bucket: string; path: string } }

const FUTURE = () => new Date();

/* ------------------------------------------------------------------ planning (read-only) */
async function planInvoice(id: string): Promise<Plan> {
  const inv = await getDoc(`invoices/${id}`); if (!inv) throw new HttpError(404, 'Invoice not found.');
  const pays = await find('payments', [EQ('invoiceId', id)]);
  const total = pays.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const writes: unknown[] = [];
  // payments are accounting evidence: keep them, but release them from the deleted invoice so nothing points at a missing invoice
  for (const p of pays) writes.push(setFields(`payments/${p.id}`, { invoiceId: '', releasedFromInvoiceNo: String(inv.invoiceNo ?? ''), unallocated: true, parentUids: [] }));
  // ...and the money goes back on the learner's account as credit, so it can pay another invoice and nothing is lost
  for (const p of pays) writes.push({ update: { name: docName(`studentCredits/rel_${p.id}`), fields: fieldsOf({ studentId: String(inv.studentId ?? ''), studentName: String(inv.studentName ?? ''), studentUid: String(inv.studentUid ?? ''), parentUids: (inv.parentUids as string[]) ?? [], amount: Number(p.amount ?? 0), remaining: Number(p.amount ?? 0), receiptNo: String(p.receiptNo ?? ''), method: String(p.method ?? 'cash'), reference: String(p.reference ?? ''), paidAt: String(p.paidAt ?? ''), termId: String(inv.termId ?? ''), termName: String(inv.termName ?? ''), structureId: String(inv.structureId ?? ''), structureName: String(inv.structureName ?? ''), note: `Released from deleted invoice ${inv.invoiceNo ?? ''}`, recordedBy: 'System (invoice deleted)', currency: String(inv.currency ?? 'NGN') }) }, updateTransforms: [{ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }] });
  writes.push(del(`invoices/${id}`));
  return { kind: 'invoice', id, label: `Invoice ${inv.invoiceNo ?? id} - ${inv.studentName ?? ''}`, loginUid: '', loginRole: '', hasLogin: false, loginNote: '', writes, archive: { invoice: inv, payments: pays.map((p) => p.id) },
    deps: [{ key: 'payments', label: 'Recorded payments (returned to the learner as credit; the receipts are kept)', count: pays.length, note: pays.length ? `NGN ${total.toLocaleString('en-NG')} released` : undefined }] };
}

async function planStudent(id: string): Promise<Plan> {
  const s = await getDoc(`students/${id}`); if (!s) throw new HttpError(404, 'Student not found.');
  const uid = String(s.studentUid ?? '');
  const [invoices, payments, results, att, enrol, subs, sessions, assigns, cards] = await Promise.all([
    find('invoices', [EQ('studentId', id)]), find('payments', [EQ('studentId', id)]), find('results', [EQ('studentId', id)]), find('attendance', [EQ('studentId', id)]),
    uid ? find('courseEnrollments', [EQ('uid', uid)]) : Promise.resolve([] as Doc[]), uid ? find('submissions', [EQ('uid', uid)]) : Promise.resolve([] as Doc[]),
    uid ? find('sessions', [HAS('studentUids', uid)]) : Promise.resolve([] as Doc[]), uid ? find('assignments', [HAS('studentUids', uid)]) : Promise.resolve([] as Doc[]),
    find('reportCards', [EQ('studentId', id)]).catch(() => [] as Doc[]),
  ]);
  const sessAtt = uid ? await find('sessionAttendance', [EQ('studentUid', uid)]) : [];
  const writes: unknown[] = [];
  // personal learning data is removed
  for (const d of results) writes.push(del(`results/${d.id}`));
  for (const d of cards) writes.push(del(`reportCards/${d.id}`));
  for (const d of att) writes.push(del(`attendance/${d.id}`));
  for (const d of sessAtt) writes.push(del(`sessionAttendance/${d.id}`));
  for (const d of enrol) writes.push(del(`courseEnrollments/${d.id}`));
  for (const d of subs) writes.push(del(`submissions/${d.id}`));
  for (const d of sessions) writes.push(pullFromArray(`sessions/${d.id}`, 'studentUids', [uid]));
  for (const d of assigns) writes.push(pullFromArray(`assignments/${d.id}`, 'studentUids', [uid]));
  // money records are accounting evidence: kept, but cut off from the family and the learner's portal
  for (const d of invoices) writes.push(setFields(`invoices/${d.id}`, { studentDeleted: true, parentUids: [], studentUid: '' }));
  for (const d of payments) writes.push(setFields(`payments/${d.id}`, { studentDeleted: true, parentUids: [], studentUid: '' }));
  const credits = await find('studentCredits', [EQ('studentId', id)]);
  for (const d of credits) writes.push(setFields(`studentCredits/${d.id}`, { studentDeleted: true, parentUids: [], studentUid: '' }));
  writes.push(del(`students/${id}`));
  const ref = s.photoRef as { provider?: string; bucket?: string; path?: string } | undefined;
  return { kind: 'student', id, label: `${s.firstName ?? ''} ${s.lastName ?? ''} (${s.studentNo ?? id})`.trim(), loginUid: uid, loginRole: 'student', hasLogin: !!uid, loginNote: '', writes, archive: { student: s, counts: { invoices: invoices.length, payments: payments.length, results: results.length } },
    photo: ref?.provider === 'supabase' && ref.bucket && ref.path ? { bucket: ref.bucket, path: ref.path } : undefined,
    deps: [
      { key: 'invoices', label: 'Invoices (kept for accounting, hidden from family)', count: invoices.length },
      { key: 'payments', label: 'Payments (kept for accounting, hidden from family)', count: payments.length },
      { key: 'results', label: 'Results and report cards (deleted)', count: results.length + cards.length },
      { key: 'attendance', label: 'Attendance records (deleted)', count: att.length + sessAtt.length },
      { key: 'lms', label: 'Course enrolments and submissions (deleted)', count: enrol.length + subs.length },
      { key: 'sessions', label: 'Timetable sessions and homework lists (learner removed)', count: sessions.length + assigns.length },
    ] };
}

async function planParent(id: string): Promise<Plan> {
  const p = await getDoc(`parents/${id}`); if (!p) throw new HttpError(404, 'Parent not found.');
  const uid = String(p.userUid ?? '');
  const kids = await find('students', [HAS('parentIds', id)]);
  const kidsByUid = uid ? await find('students', [HAS('parentUids', uid)]) : [];
  const all = new Map([...kids, ...kidsByUid].map((k) => [k.id, k]));
  const writes: unknown[] = [];
  for (const k of all.values()) {
    writes.push(pullFromArray(`students/${k.id}`, 'parentIds', [id]));
    if (uid) writes.push(pullFromArray(`students/${k.id}`, 'parentUids', [uid]));
  }
  let owing = 0; let invCount = 0;
  if (uid) {
    const [invs, pays, sess, subs, asg] = await Promise.all([find('invoices', [HAS('parentUids', uid)]), find('payments', [HAS('parentUids', uid)]), find('sessions', [HAS('parentUids', uid)]), find('submissions', [HAS('parentUids', uid)]), find('assignments', [HAS('parentViewers', uid)])]);
    for (const d of invs) { writes.push(pullFromArray(`invoices/${d.id}`, 'parentUids', [uid])); owing += Math.max(0, Number(d.balance ?? 0)); invCount++; }
    for (const d of pays) writes.push(pullFromArray(`payments/${d.id}`, 'parentUids', [uid]));
    for (const d of sess) writes.push(pullFromArray(`sessions/${d.id}`, 'parentUids', [uid]));
    for (const d of subs) writes.push(pullFromArray(`submissions/${d.id}`, 'parentUids', [uid]));
    for (const d of asg) writes.push(pullFromArray(`assignments/${d.id}`, 'parentViewers', [uid]));
  }
  writes.push(del(`parents/${id}`));
  return { kind: 'parent', id, label: `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || id, loginUid: uid, loginRole: 'parent', hasLogin: !!uid, loginNote: '', writes, archive: { parent: p, childIds: [...all.keys()] },
    deps: [
      { key: 'children', label: 'Linked children (kept; this parent loses access to them)', count: all.size, note: all.size ? 'Link another guardian to these children afterwards if needed.' : undefined },
      { key: 'invoices', label: 'Open invoices this parent could see', count: invCount, note: owing ? `NGN ${owing.toLocaleString('en-NG')} outstanding stays on the learners' accounts` : undefined },
    ] };
}

async function planStaff(id: string): Promise<Plan> {
  const st = await getDoc(`staff/${id}`); if (!st) throw new HttpError(404, 'Staff member not found.');
  const uid = String(st.userUid ?? '');
  const [classes, assigns, courses, sessions] = await Promise.all([
    find('classes', [EQ('classTeacherId', id)]), uid ? find('teacherAssignments', [EQ('staffUid', uid)]) : find('teacherAssignments', [EQ('staffId', id)]),
    uid ? find('courses', [EQ('instructorUid', uid)]) : Promise.resolve([] as Doc[]), uid ? find('sessions', [EQ('teacherUid', uid)]) : Promise.resolve([] as Doc[]),
  ]);
  const now = FUTURE().getTime();
  const upcoming = sessions.filter((s) => s.status === 'scheduled' && Number(s.startAt) >= now);
  const writes: unknown[] = [];
  for (const c of classes) writes.push(setFields(`classes/${c.id}`, { classTeacherId: '', classTeacherUid: '', classTeacherName: '' }));
  for (const a of assigns) writes.push(del(`teacherAssignments/${a.id}`));
  for (const c of courses) writes.push(setFields(`courses/${c.id}`, { instructorUid: '', instructorName: '' }));
  writes.push(del(`staff/${id}`));
  const ref = st.photoRef as { provider?: string; bucket?: string; path?: string } | undefined;
  return { kind: 'staff', id, label: `${st.firstName ?? ''} ${st.lastName ?? ''}`.trim() || id, loginUid: uid, loginRole: String(st.role ?? 'teacher'), hasLogin: !!uid, loginNote: '', writes, archive: { staff: st },
    photo: ref?.provider === 'supabase' && ref.bucket && ref.path ? { bucket: ref.bucket, path: ref.path } : undefined,
    deps: [
      { key: 'sessions', label: 'Upcoming scheduled sessions (must be reassigned or cancelled first)', count: upcoming.length, blocking: upcoming.length > 0 },
      { key: 'classes', label: 'Classes where this person is class teacher (cleared)', count: classes.length },
      { key: 'assignments', label: 'Subject/class teaching assignments (removed)', count: assigns.length },
      { key: 'courses', label: 'Courses taught (instructor cleared; reassign afterwards)', count: courses.length },
      { key: 'past', label: 'Past sessions (kept as history)', count: sessions.length - upcoming.length },
    ] };
}

async function plan(kind: string, id: string): Promise<Plan> {
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new HttpError(400, 'Invalid record id.');
  if (kind === 'invoice') return planInvoice(id);
  if (kind === 'student') return planStudent(id);
  if (kind === 'parent') return planParent(id);
  if (kind === 'staff') return planStaff(id);
  throw new HttpError(400, 'Unknown record type.');
}

/* ------------------------------------------------------------------ login handling */
async function loginAction(p: Plan, actorUid: string, deleteLogin: boolean): Promise<string> {
  if (!p.hasLogin) return 'no login account';
  const u = await getDoc(`users/${p.loginUid}`);
  if (!u) return 'login profile already gone';
  if (p.loginUid === actorUid) throw new HttpError(400, 'You cannot delete your own account.');
  const roles = ((u.roles as string[]) ?? [String(u.role)]).filter(Boolean);
  if (roles.includes('super_admin')) throw new HttpError(403, 'A super admin account cannot be removed here.');
  const others = roles.filter((r) => r !== p.loginRole);
  if (!deleteLogin) return 'login account kept';
  if (others.length > 0) {   // the same person has another role (e.g. teacher and parent): remove only this role, keep the account
    await commit([pullFromArray(`users/${p.loginUid}`, 'roles', [p.loginRole]), setFields(`users/${p.loginUid}`, { role: others[0] })]);
    return `role "${p.loginRole}" removed, account kept because the person has other roles (${others.join(', ')})`;
  }
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:delete`, { method: 'POST', headers: await H(), body: JSON.stringify({ localId: p.loginUid }) });
  if (!r.ok && r.status !== 400) throw new HttpError(502, 'Could not remove the login account. The records were already cleaned; retry to remove the login.');
  await commit([del(`users/${p.loginUid}`)]);
  return 'login account deleted';
}

async function deletePhoto(ph?: { bucket: string; path: string }) {
  if (!ph || !env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY')) return;
  await fetch(`${env('SUPABASE_URL')}/storage/v1/object/${ph.bucket}/${ph.path.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE', headers: { Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`, apikey: env('SUPABASE_SERVICE_ROLE_KEY') } }).catch(() => undefined);
}

/* ------------------------------------------------------------------ routing */
const ALLOWED: Record<string, string[]> = { student: ['super_admin', 'admin'], parent: ['super_admin', 'admin'], staff: ['super_admin', 'admin'], invoice: ['super_admin', 'admin', 'finance'] };

// deno-lint-ignore no-explicit-any
async function handle(req: Request, b: any): Promise<unknown> {
  if (!PROJECT) throw new HttpError(500, 'Not configured (FIREBASE_PROJECT_ID).');
  const uid = await verifyUser(req);
  const me = await actor(uid);
  const kind = String(b.kind ?? ''); const id = String(b.id ?? '');
  if (!ALLOWED[kind]) throw new HttpError(400, 'Unknown record type.');
  if (!me.roles.some((r) => ALLOWED[kind]!.includes(r))) throw new HttpError(403, 'You do not have permission to delete this kind of record.');
  const p = await plan(kind, id);
  const summary = { kind, id, label: p.label, deps: p.deps, hasLogin: p.hasLogin, blocked: p.deps.some((d) => d.blocking && d.count > 0) };

  if (b.action === 'check') return summary;
  if (b.action !== 'delete') throw new HttpError(400, 'Unknown action.');
  if (String(b.confirm ?? '').trim() !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  if (summary.blocked) throw new HttpError(409, 'Resolve the blocking items first (see the list), then try again.');

  // 1. restricted archive copy (server-only collection) and audit entry, written BEFORE anything is removed
  const now = 'REQUEST_TIME'; const archiveId = `${kind}_${id}_${Date.now()}`;
  await commit([
    { update: { name: docName(`deletionArchive/${archiveId}`), fields: fieldsOf({ kind, recordId: id, label: p.label, snapshot: JSON.stringify(p.archive).slice(0, 900_000), deps: p.deps, deletedBy: uid, deletedByName: me.name }) }, updateTransforms: [{ fieldPath: 'deletedAt', setToServerValue: now }] },
  ]);
  // 2. resolve dependencies and delete the record itself (one atomic commit per 400 writes; the record's own delete is last)
  await commit(p.writes);
  await deletePhoto(p.photo);
  // 3. login account
  const loginResult = await loginAction(p, uid, b.deleteLogin === true);
  await commit([{ update: { name: docName(`auditLogs/${crypto.randomUUID().replace(/-/g, '')}`), fields: fieldsOf({ action: `${kind}.delete`, target: `${kind}s/${id}`, detail: `${p.label}; ${p.deps.filter((d) => d.count).map((d) => `${d.key}:${d.count}`).join(', ')}; ${loginResult}; archive ${archiveId}`.slice(0, 500), actorUid: uid, actorRole: me.roles[0] ?? '', actorName: me.name }) }, updateTransforms: [{ fieldPath: 'at', setToServerValue: now }] }]);
  return { ok: true, label: p.label, login: loginResult, archiveId };
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
