/** Pure rules for presentations, video progress, lesson completion and the parent learning monitor. Unit-tested. */

/* ------------------------------------------------------------ presentations */
export type PresentationKind = 'pdf' | 'pptx' | 'slides' | 'other';

/** Google Slides link -> embeddable URL. Only docs.google.com/presentation links are accepted. */
export function googleSlidesEmbed(input: string): string | null {
  let u: URL;
  try { u = new URL((input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const seg = u.pathname.split('/').filter(Boolean);
  if (seg[0] !== 'presentation' || seg[1] !== 'd') return null;
  if (seg[2] === 'e') { const id = seg[3]; return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? `https://docs.google.com/presentation/d/e/${id}/embed?start=false&loop=false` : null; }
  const id = seg[2];
  return id && /^[A-Za-z0-9_-]{10,}$/.test(id) ? `https://docs.google.com/presentation/d/${id}/embed?start=false&loop=false` : null;
}

export function presentationKind(x: { url?: string; fileName?: string; contentType?: string }): PresentationKind {
  if (x.url && googleSlidesEmbed(x.url)) return 'slides';
  const name = `${x.fileName ?? ''} ${(x.url ?? '').split('?')[0]}`.toLowerCase();
  const ct = (x.contentType ?? '').toLowerCase();
  if (ct === 'application/pdf' || /\.pdf\b/.test(name)) return 'pdf';
  if (/presentationml|ms-powerpoint/.test(ct) || /\.(pptx?|ppsx|potx)\b/.test(name)) return 'pptx';
  return 'other';
}

/**
 * PowerPoint files cannot be drawn by a browser. Microsoft's free Office viewer can, but it must be able to download the file,
 * so only a public https link qualifies (never localhost, a private address or a non-https link).
 */
export function officeViewerSrc(url: string): string | null {
  let u: URL;
  try { u = new URL((url || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === '[::1]') return null;
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(u.toString())}`;
}

/** Canvas scale for a PDF page: 100% means "fit the page width to the viewer". */
export function fitScale(containerWidth: number, pageWidth: number, zoomPct: number): number {
  if (!(containerWidth > 0) || !(pageWidth > 0)) return 1;
  const s = (containerWidth / pageWidth) * (zoomPct / 100);
  return Math.min(6, Math.max(0.2, s));
}

export const ZOOMS = [50, 75, 100, 125, 150, 200] as const;
export function stepZoom(z: number, dir: 1 | -1): number {
  const i = ZOOMS.findIndex((v) => v >= z);
  const at = i < 0 ? ZOOMS.length - 1 : i;
  return ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, at + dir))]!;
}
export function clampPage(p: number, total?: number): number {
  const n = Number.isFinite(p) ? Math.floor(p) : 1;
  return Math.max(1, total && total > 0 ? Math.min(total, n) : n);
}
/** Browser-native PDF viewers understand #page and #zoom. The browser, not this app, counts pages. */
export function pdfSrc(url: string, page: number, zoom: number): string {
  return `${url.split('#')[0]}#page=${clampPage(page)}&zoom=${zoom}`;
}

/* ------------------------------------------------------------ video progress */
export type Range = [number, number];
/** Add a played stretch. Only natural playback counts: seeking forward (a jump over 2 s) adds nothing. */
export function addPlayed(ranges: Range[], from: number, to: number): Range[] {
  if (!(to > from) || to - from > 2 || from < 0) return ranges;
  const all = [...ranges, [from, to] as Range].sort((a, b) => a[0] - b[0]);
  const out: Range[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + 0.05) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
  }
  return out;
}
export const watchedSeconds = (r: Range[]) => r.reduce((n, [a, b]) => n + (b - a), 0);
export function watchedPct(r: Range[], duration: number): number {
  if (!(duration > 0)) return 0;
  return Math.min(100, Math.round((watchedSeconds(r) / duration) * 100));
}
/** Compact form for Firestore (whole seconds), at most 60 ranges. */
export function packRanges(r: Range[]): number[][] { return r.slice(0, 60).map(([a, b]) => [Math.floor(a), Math.ceil(b)]); }
export function unpackRanges(v: unknown): Range[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is number[] => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) && (x[1] as number) > (x[0] as number)).slice(0, 60).map((x) => [x[0]!, x[1]!] as Range);
}

/* --------------------------------------------------------- completion rules */
export type CompletionRule = 'manual' | 'watch';
export const WATCH_THRESHOLD = 90;
/**
 * A lesson is never completed by opening it. 'manual' lets the learner confirm; 'watch' needs real, tracked
 * playback of at least 90% and is only honoured for videos the app can measure (direct files).
 */
export function canComplete(rule: CompletionRule | undefined, o: { trackable: boolean; watchedPct: number }): { ok: boolean; reason?: string } {
  if (rule === 'watch' && o.trackable && o.watchedPct < WATCH_THRESHOLD) return { ok: false, reason: `Watch at least ${WATCH_THRESHOLD}% of the video first (you are at ${o.watchedPct}%).` };
  return { ok: true };
}
export const isTrackable = (provider: string | undefined) => provider === 'direct';

export function courseSummary(order: string[], done: Set<string>) {
  const total = order.length; const n = order.filter((id) => done.has(id)).length;
  return { total, done: n, pct: total ? Math.round((n / total) * 100) : 0, nextId: order.find((id) => !done.has(id)) ?? null };
}

/* ------------------------------------------------------- parent monitor */
export interface EnrolLite { courseId: string; courseTitle: string; progressPct: number; completedLessons: number; totalLessons?: number; lastActivityMs?: number; status: string }
export interface SubLite { status: string; score?: number | null }
export interface ChildSummary { courses: EnrolLite[]; avgProgress: number | null; lessonsDone: number; lastActivityMs: number | null; submitted: number; marked: number; hasData: boolean }
/** Every figure comes from a stored record; with no records the figures are null/0 and hasData is false. */
export function summariseChild(enrols: EnrolLite[], subs: SubLite[], activityMs: number[] = []): ChildSummary {
  const acts = [...activityMs, ...enrols.map((e) => e.lastActivityMs ?? 0)].filter((n) => n > 0);
  return {
    courses: enrols,
    avgProgress: enrols.length ? Math.round(enrols.reduce((n, e) => n + e.progressPct, 0) / enrols.length) : null,
    lessonsDone: enrols.reduce((n, e) => n + e.completedLessons, 0),
    lastActivityMs: acts.length ? Math.max(...acts) : null,
    submitted: subs.length, marked: subs.filter((s) => s.status === 'marked' || s.status === 'graded' || typeof s.score === 'number').length,
    hasData: enrols.length > 0 || subs.length > 0,
  };
}
export function daysSince(ms: number | null, now = Date.now()): number | null { return ms == null ? null : Math.max(0, Math.floor((now - ms) / 86_400_000)); }
