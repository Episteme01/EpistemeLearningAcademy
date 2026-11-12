import { z } from 'zod';

/** Pure helpers for ELA Social Spotlight and the video-learning system (no network, unit-tested). */
export type VideoProvider = 'youtube' | 'vimeo' | 'drive' | 'direct';
export interface ParsedVideo { provider: VideoProvider; id: string; embedUrl: string; watchUrl: string; thumbUrl: string | null; label: string }

const YT = /^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
/**
 * Turns a pasted link into a safe player address, or null. Only these hosts are ever embedded:
 * YouTube, Vimeo and Google Drive previews. Direct files must be https .mp4/.webm and are played with
 * <video>, never an iframe. Anything else (javascript:, data:, unknown sites) returns null.
 */
export function parseVideoUrl(input: string): ParsedVideo | null {
  let u: URL;
  try { u = new URL((input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean);
  if (YT.test(host) || host === 'youtu.be') {
    const id = host === 'youtu.be' ? seg[0] : u.pathname === '/watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(seg[0]) ? seg[1] : null;
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { provider: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`, watchUrl: `https://www.youtube.com/watch?v=${id}`, thumbUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, label: 'YouTube' };
  }
  if (host === 'vimeo.com' || host === 'www.vimeo.com' || host === 'player.vimeo.com') {
    const parts = host === 'player.vimeo.com' ? seg.slice(1) : seg;
    const id = parts.find((s) => /^\d{5,}$/.test(s));
    if (!id) return null;
    const hash = u.searchParams.get('h') || parts[parts.indexOf(id) + 1];
    const h = hash && /^[a-f0-9]{6,}$/i.test(hash) ? `&h=${hash}` : '';
    return { provider: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1${h}`, watchUrl: `https://vimeo.com/${id}`, thumbUrl: null, label: 'Vimeo' };
  }
  if (host === 'drive.google.com') {
    const i = seg.indexOf('d');
    const id = i >= 0 ? seg[i + 1] : u.searchParams.get('id');
    if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return null;
    return { provider: 'drive', id, embedUrl: `https://drive.google.com/file/d/${id}/preview`, watchUrl: `https://drive.google.com/file/d/${id}/view`, thumbUrl: null, label: 'Google Drive' };
  }
  if (/\.(mp4|webm)$/i.test(u.pathname) && !u.username && !u.password) return { provider: 'direct', id: u.pathname, embedUrl: u.toString(), watchUrl: u.toString(), thumbUrl: null, label: 'Video file' };
  return null;
}

/* -------------------------------------------------------------- posts */
export interface SpotlightPost {
  id: string; type: 'image' | 'video' | 'text'; title: string; caption?: string; body?: string;
  thumbnailUrl?: string; imageUrl?: string; videoUrl?: string; status: 'draft' | 'published'; featured?: boolean; order?: number; publishedAtMs?: number;
}
/** Published, already-due posts: featured first, then manual order, then newest. */
export function visiblePosts<T extends SpotlightPost>(posts: T[], nowMs = Date.now()): T[] {
  return posts.filter((p) => p.status === 'published' && (p.publishedAtMs ?? 0) <= nowMs)
    .sort((a, b) => Number(!!b.featured) - Number(!!a.featured) || (a.order ?? 999) - (b.order ?? 999) || (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0));
}
export const homepagePosts = <T extends SpotlightPost>(posts: T[], n = 4, nowMs = Date.now()) => visiblePosts(posts, nowMs).slice(0, n);
/** Picture shown on a card: custom thumbnail, else the image itself, else the provider's thumbnail. */
export function cardImage(p: SpotlightPost): string | null {
  return p.thumbnailUrl || (p.type === 'image' ? p.imageUrl : '') || (p.type === 'video' && p.videoUrl ? parseVideoUrl(p.videoUrl)?.thumbUrl ?? '' : '') || null;
}
/** Next/previous index with wrap-around. */
export const stepIndex = (i: number, d: number, n: number) => (n ? (i + d + n) % n : 0);
/** Vertical swipe → -1 (previous) / 1 (next) / 0 (ignore). Mostly-vertical drags only. */
export function swipeDir(dx: number, dy: number, min = 48): -1 | 0 | 1 {
  if (Math.abs(dy) < min || Math.abs(dy) < Math.abs(dx) * 1.2) return 0;
  return dy < 0 ? 1 : -1;
}

/** Zod schema used by the CMS form on top of the generic field validation. */
export const spotlightSchema = z.object({
  type: z.enum(['image', 'video', 'text']),
  title: z.string().trim().min(2, 'Add a title').max(140),
  caption: z.string().max(300).optional(),
  imageUrl: z.string().optional(), thumbnailUrl: z.string().optional(), videoUrl: z.string().optional(), body: z.string().optional(),
}).superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const https = (s?: string) => !s || /^https:\/\//i.test(s);
  if (!https(v.imageUrl)) issue('imageUrl', 'Use an https image link.');
  if (!https(v.thumbnailUrl)) issue('thumbnailUrl', 'Use an https thumbnail link.');
  if (v.type === 'image' && !v.imageUrl) issue('imageUrl', 'Add the picture for an image post.');
  if (v.type === 'video') {
    if (!v.videoUrl) issue('videoUrl', 'Add the video link.');
    else if (!parseVideoUrl(v.videoUrl)) issue('videoUrl', 'This video link is not supported. Use YouTube, Vimeo, a Google Drive file link, or a direct https .mp4/.webm file.');
  }
  if (v.type === 'text' && !(v.body && v.body.replace(/<[^>]*>/g, '').trim())) issue('body', 'Write the post text.');
});
