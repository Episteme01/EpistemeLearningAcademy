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
