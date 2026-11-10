import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify } from 'npm:jose@5';
import webpush from 'npm:web-push@3.6.7';

// ---- logic (was logic.ts) ----
// Pure helpers for the notification engine (no Deno / browser APIs), so they can be unit-tested in Node.

export const TZ = 'Africa/Lagos';
export const DEFAULT_REMINDER_MINUTES = [60, 10];
export const DEFAULT_ASSIGNMENT_HOURS = 24;
/** The scheduler runs every 5 minutes; a reminder is still sent if the run is up to this late. */
export const GRACE_MINUTES = 12;

export type NoticeAudience = 'class_parents' | 'class_students' | 'class_both' | 'all_parents' | 'all_students' | 'all_staff';
export const CLASS_AUDIENCES: NoticeAudience[] = ['class_parents', 'class_students', 'class_both'];
export const NOTICE_AUDIENCES: NoticeAudience[] = [...CLASS_AUDIENCES, 'all_parents', 'all_students', 'all_staff'];

/** Which "minutes before start" reminders are due now for a class that starts at startMs. */
export function dueReminderOffsets(startMs: number, nowMs: number, offsets: number[], graceMin = GRACE_MINUTES): number[] {
  if (nowMs >= startMs) return [];
  return offsets.filter((m) => {
    const at = startMs - m * 60_000;
    return nowMs >= at && nowMs - at <= graceMin * 60_000;
  });
}

/** True when an assignment deadline is `hours` away (within the scheduler window). */
export function assignmentReminderDue(dueMs: number, nowMs: number, hours: number, graceMin = GRACE_MINUTES): boolean {
  if (nowMs >= dueMs) return false;
  const at = dueMs - hours * 3_600_000;
  return nowMs >= at && nowMs - at <= graceMin * 60_000;
}

export const cleanOffsets = (v: unknown): number[] => {
  const arr = Array.isArray(v) ? v : [];
  const out = [...new Set(arr.map(Number).filter((n) => Number.isFinite(n) && n >= 5 && n <= 1440).map(Math.round))].sort((a, b) => b - a);
  return out.length ? out.slice(0, 4) : DEFAULT_REMINDER_MINUTES;
};

export const lagosTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms));
export const lagosDateTime = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms));

export function reminderText(title: string, startMs: number, minutes: number): { title: string; body: string } {
  const when = minutes >= 60 ? (minutes % 60 === 0 ? `${minutes / 60} hour${minutes === 60 ? '' : 's'}` : `${minutes} minutes`) : `${minutes} minutes`;
  return { title: `Class in ${when}: ${title}`, body: `${title} starts at ${lagosTime(startMs)}. Open the timetable to join.` };
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export function emailHtml(school: string, title: string, body: string, link?: string): string {
  const para = escapeHtml(body).replace(/\n/g, '<br>');
  const btn = link ? `<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0B3D2E;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Open in the portal</a></p>` : '';
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c1c1c"><h2 style="color:#0B3D2E">${escapeHtml(title)}</h2><p style="line-height:1.55">${para}</p>${btn}<hr style="border:none;border-top:1px solid #ddd"><p style="font-size:12px;color:#777">${escapeHtml(school)}. You can turn email notices off in your portal profile.</p></div>`;
}

export const validEmail = (e: unknown): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

/** Splits a list into chunks (Firestore `in` queries and batch limits). */
export function chunk<T>(a: T[], n: number): T[][] { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

/** Recipients for a notice, from the students it concerns (already filtered to one class or the whole school). */
export function noticeRecipients(audience: NoticeAudience, students: { studentUid?: string; parentUids?: string[] }[], staffUids: string[] = []): string[] {
  const kids = students.map((s) => s.studentUid).filter((x): x is string => !!x);
  const parents = students.flatMap((s) => s.parentUids ?? []).filter(Boolean);
  switch (audience) {
    case 'class_parents': case 'all_parents': return [...new Set(parents)];
    case 'class_students': case 'all_students': return [...new Set(kids)];
    case 'class_both': return [...new Set([...parents, ...kids])];
    case 'all_staff': return [...new Set(staffUids)];
    default: return [];
  }
}

/** Per-user delivery choice. Defaults: in-app always; email and push on unless the user turned them off. */
export function channelsFor(prefs: { email?: boolean; push?: boolean } | null, hasEmail: boolean, hasPush: boolean, emailAllowed: boolean, pushAllowed: boolean) {
  return { inApp: true, email: emailAllowed && hasEmail && prefs?.email !== false, push: pushAllowed && hasPush && prefs?.push !== false };
}

// ---- function ----
// ELA notification engine: a second small Supabase Edge Function (free plan).
//
// Every 5 minutes a Supabase cron job calls { action: 'tick' } and this function:
//   1. sends class reminders (before a timetable session starts),
//   2. sends homework-due reminders (before an assignment deadline),
//   3. delivers queued notices written by staff (class notices to parents/students, school-wide notices).
// Each person gets an in-app notification, plus email (Brevo) and web push if they have them switched on.
// It reads/writes Firestore with the Firebase service account, so it works on the free Spark plan.
//
// Deploy (JWT verification OFF; the cron secret and Firebase tokens are checked in the code):
//   supabase functions deploy notify --no-verify-jwt
// Secrets (Supabase dashboard > Edge Functions > Secrets), never in GitHub or the app:
//   FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT, CRON_SECRET, SITE_URL, ALLOWED_ORIGINS (optional)
//   BREVO_API_KEY, MAIL_FROM_EMAIL, MAIL_FROM_NAME           (email; optional)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT       (push; optional, e.g. mailto:you@gmail.com)

const env = (k: string) => Deno.env.get(k) ?? '';
const PROJECT = env('FIREBASE_PROJECT_ID');
const SITE = (env('SITE_URL') || 'https://episteme01.github.io/epistemelearningacademy').replace(/\/+$/, '');
const SCHOOL = 'Episteme Learning Academy';
const ORIGINS = (env('ALLOWED_ORIGINS') || 'https://episteme01.github.io').split(',').map((s) => s.trim()).filter(Boolean);
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const FS_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const EMAIL_PER_RUN = 100;      // stays inside Brevo's free daily allowance (300/day)
const STAFF_ROLES = ['super_admin', 'admin', 'principal', 'teacher'];

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

/* ------------------------------------------------------------------ delivery */
const vapidOn = () => !!(env('VAPID_PUBLIC_KEY') && env('VAPID_PRIVATE_KEY'));
if (vapidOn()) webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:admin@example.com', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));

interface Msg { title: string; body: string; link: string }
interface Stats { inApp: number; email: number; push: number; emailSkipped: number }
const newStats = (): Stats => ({ inApp: 0, email: 0, push: 0, emailSkipped: 0 });

async function sendEmail(to: string, m: Msg): Promise<boolean> {
  const key = env('BREVO_API_KEY'); const from = env('MAIL_FROM_EMAIL');
  if (!key || !validEmail(from)) return false;
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: env('MAIL_FROM_NAME') || SCHOOL, email: from }, to: [{ email: to }], subject: m.title, htmlContent: emailHtml(SCHOOL, m.title, m.body, `${SITE}${m.link.startsWith('/') ? '/#' : ''}${m.link}`) }),
  });
  return r.ok;
}

async function deliver(uids: string[], m: Msg, st: Stats, opts: { email: boolean; push: boolean }) {
  const list = [...new Set(uids.filter(Boolean))];
  await addInApp(list.map((uid) => ({ uid, ...m })));
  st.inApp += list.length;
  for (const group of chunk(list, 8)) {
    await Promise.all(group.map(async (uid) => {
      try {
        const [user, prefs, subs] = await Promise.all([getDoc(`users/${uid}`), getDoc(`notificationPrefs/${uid}`), vapidOn() && opts.push ? query('pushSubscriptions', [{ field: 'uid', op: 'EQUAL', value: uid }], 10) : Promise.resolve([] as Doc[])]);
        // learners who sign in with a username have a hidden internal address, never a real mailbox
        const email = user && !user.username && validEmail(user.email) ? String(user.email) : '';
        const ch = channelsFor(prefs as { email?: boolean; push?: boolean } | null, !!email, subs.length > 0, opts.email, opts.push);
        if (ch.email) { if (st.email >= EMAIL_PER_RUN) st.emailSkipped += 1; else if (await sendEmail(email, m)) st.email += 1; }
        if (ch.push) {
          const payload = JSON.stringify({ title: m.title, body: m.body, url: `${SITE}/#${m.link}` });
          for (const s of subs) {
            try { await webpush.sendNotification({ endpoint: String(s.endpoint), keys: { p256dh: String((s.keys as Record<string, string>)?.p256dh), auth: String((s.keys as Record<string, string>)?.auth) } }, payload, { TTL: 3600 }); st.push += 1; }
            catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await remove(`pushSubscriptions/${s.id}`); }
          }
        }
      } catch (e) { console.error('deliver failed for', uid, e); }
    }));
  }
}

/* ------------------------------------------------------------------ jobs */
async function settings() {
  const s = await getDoc('settings/notifications');
  return {
    minutes: cleanOffsets(s?.reminderMinutes),
    assignmentHours: Number(s?.assignmentHours) > 0 ? Number(s?.assignmentHours) : DEFAULT_ASSIGNMENT_HOURS,
    classReminders: s?.classReminders !== false, homeworkReminders: s?.homeworkReminders !== false, email: s?.email !== false, push: s?.push !== false,
  };
}

async function classReminders(now: number, cfg: Awaited<ReturnType<typeof settings>>, st: Stats) {
  const horizon = Math.max(...cfg.minutes) * 60_000 + 60_000;
  const sessions = await query('sessions', [{ field: 'startAt', op: 'GREATER_THAN_OR_EQUAL', value: new Date(now) }, { field: 'startAt', op: 'LESS_THAN_OR_EQUAL', value: new Date(now + horizon) }], 300);
  let sent = 0;
  for (const s of sessions) {
    if (s.status !== 'scheduled') continue;
    for (const m of dueReminderOffsets(Number(s.startAt), now, cfg.minutes)) {
      if (!(await createOnce('reminderLog', `session_${s.id}_${m}`, { kind: 'session', refId: s.id, minutes: m, at: new Date(now) }))) continue;   // already sent
      const t = reminderText(String(s.title), Number(s.startAt), m);
      const people = [String(s.teacherUid ?? ''), ...((s.studentUids as string[]) ?? []), ...((s.parentUids as string[]) ?? [])];
      await deliver(people, { ...t, link: '/app/schedule' }, st, { email: cfg.email, push: cfg.push }); sent += 1;
    }
  }
  return sent;
}

async function homeworkReminders(now: number, cfg: Awaited<ReturnType<typeof settings>>, st: Stats) {
  const horizon = cfg.assignmentHours * 3_600_000 + 60_000;
  const rows = await query('assignments', [{ field: 'dueAt', op: 'GREATER_THAN_OR_EQUAL', value: new Date(now) }, { field: 'dueAt', op: 'LESS_THAN_OR_EQUAL', value: new Date(now + horizon) }], 300);
  let sent = 0;
  for (const a of rows) {
    if (!assignmentReminderDue(Number(a.dueAt), now, cfg.assignmentHours)) continue;
    if (!(await createOnce('reminderLog', `assignment_${a.id}_${cfg.assignmentHours}`, { kind: 'assignment', refId: a.id, hours: cfg.assignmentHours, at: new Date(now) }))) continue;
    const kids = (a.studentUids as string[]) ?? [];
    const pending: string[] = [];
    for (const u of kids) if (!(await getDoc(`submissions/${a.id}_${u}`))) pending.push(u);      // only learners who have not handed in
    const m: Msg = { title: `Due soon: ${a.title}`, body: `"${a.title}" is due ${lagosDateTime(Number(a.dueAt))}. ${pending.length ? 'Please submit it before the deadline.' : ''}`.trim(), link: '/app/lms/assignments' };
    await deliver([...pending, ...((a.parentViewers as string[]) ?? [])], m, st, { email: cfg.email, push: cfg.push }); sent += 1;
  }
  return sent;
}

async function processNotices(cfg: Awaited<ReturnType<typeof settings>>, st: Stats, only?: string) {
  const queued = await query('notices', [{ field: 'status', op: 'EQUAL', value: 'queued' }], 20);
  let done = 0;
  for (const n of queued) {
    if (only && n.id !== only) continue;
    const audience = String(n.audience) as NoticeAudience;
    if (!NOTICE_AUDIENCES.includes(audience)) { await patch(`notices/${n.id}`, { status: 'failed', error: 'Unknown audience' }); continue; }
    await patch(`notices/${n.id}`, { status: 'processing' });
    try {
      let people: { studentUid?: string; parentUids?: string[] }[] = []; let staff: string[] = [];
      if (audience === 'all_staff') staff = (await query('users', [{ field: 'status', op: 'EQUAL', value: 'active' }], 1500)).filter((u) => ((u.roles as string[]) ?? [String(u.role)]).some((r) => STAFF_ROLES.includes(r))).map((u) => u.id);
      else if (CLASS_AUDIENCES.includes(audience)) people = (await query('students', [{ field: 'classId', op: 'EQUAL', value: String(n.classId ?? '') }], 800)).filter((s) => s.status !== 'withdrawn' && s.status !== 'graduated') as never;
      else people = (await query('students', [], 2000)) as never;
      const recipients = noticeRecipients(audience, people, staff).slice(0, 900);
      const local = newStats();
      await deliver(recipients, { title: String(n.title), body: String(n.body), link: '/app/notices' }, local, { email: n.sendEmail !== false && cfg.email, push: n.sendPush !== false && cfg.push });
      await patch(`notices/${n.id}`, { status: 'sent', recipientUids: recipients, recipientCount: recipients.length, emailSent: local.email, pushSent: local.push, emailSkipped: local.emailSkipped, processedAt: new Date() });
      st.inApp += local.inApp; st.email += local.email; st.push += local.push; st.emailSkipped += local.emailSkipped; done += 1;
    } catch (e) { console.error('notice failed', n.id, e); await patch(`notices/${n.id}`, { status: 'failed', error: e instanceof Error ? e.message.slice(0, 200) : 'error' }); }
  }
  return done;
}

/* ------------------------------------------------------------------ auth for staff actions */
async function verify(req: Request): Promise<{ uid: string; token: string }> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new HttpError(401, 'Please sign in again.');
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${PROJECT}`, audience: PROJECT });
    if (!payload.sub) throw new Error('no sub');
    return { uid: payload.sub, token };
  } catch { throw new HttpError(401, 'Your session is not valid. Sign in again.'); }
}
async function rolesOf(uid: string): Promise<string[]> {
  const u = await getDoc(`users/${uid}`);
  if (!u || u.status !== 'active') throw new HttpError(403, 'No active portal profile for this account.');
  const roles = ((u.roles as string[]) ?? []).slice(); if (u.role && !roles.includes(String(u.role))) roles.push(String(u.role));
  return roles;
}
const timingSafe = (a: string, b: string) => a.length === b.length && [...a].reduce((x, c, i) => x | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;

// deno-lint-ignore no-explicit-any
async function handle(req: Request, b: any): Promise<unknown> {
  const action = String(b.action ?? '');
  if (!PROJECT) throw new HttpError(500, 'The notification service is not configured yet (FIREBASE_PROJECT_ID).');

  if (action === 'tick') {
    const secret = env('CRON_SECRET'); const given = req.headers.get('x-cron-secret') ?? '';
    if (!secret || !timingSafe(secret, given)) throw new HttpError(401, 'Not allowed.');
    const now = Date.now(); const st = newStats(); const cfg = await settings();
    const out = { classReminders: 0, homeworkReminders: 0, notices: 0 };
    if (cfg.classReminders) out.classReminders = await classReminders(now, cfg, st);
    if (cfg.homeworkReminders) out.homeworkReminders = await homeworkReminders(now, cfg, st);
    out.notices = await processNotices(cfg, st);
    return { ok: true, ...out, ...st };
  }

  const { uid } = await verify(req);
  const roles = await rolesOf(uid);

  if (action === 'run-now') {                       // staff pressed "Send now" on a notice
    if (!roles.some((r) => STAFF_ROLES.includes(r))) throw new HttpError(403, 'Only staff can send notices.');
    const st = newStats(); const n = await processNotices(await settings(), st, String(b.noticeId ?? ''));
    return { ok: true, notices: n, ...st };
  }
  if (action === 'test') {                          // "Send me a test" in notification settings
    const st = newStats(); const cfg = await settings();
    await deliver([uid], { title: 'Test notification', body: 'If you can read this, notifications work on this account.', link: '/app/notices' }, st, { email: cfg.email, push: cfg.push });
    return { ok: true, ...st, emailConfigured: !!env('BREVO_API_KEY') && validEmail(env('MAIL_FROM_EMAIL')), pushConfigured: vapidOn() };
  }
  if (action === 'generate-vapid') {               // one-time, super admin only: makes the push key pair
    if (!roles.includes('super_admin')) throw new HttpError(403, 'Only a super admin can do this.');
    return webpush.generateVAPIDKeys();
  }
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
