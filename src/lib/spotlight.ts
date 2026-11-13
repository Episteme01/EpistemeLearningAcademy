import { z } from 'zod';

/** Pure helpers for ELA Social Spotlight and the video-learning system (no network, unit-tested). */
export type VideoProvider = 'youtube' | 'vimeo' | 'drive' | 'direct' | 'dailymotion' | 'facebook' | 'instagram' | 'tiktok' | 'streamable' | 'loom' | 'link';
/** embedUrl is empty for provider 'link' (any other https page): such videos are shown as a button that opens the site, never framed. */
export interface ParsedVideo { provider: VideoProvider; id: string; embedUrl: string; watchUrl: string; thumbUrl: string | null; label: string }

const YT = /^(?:www\.|m\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const DIRECT = /\.(mp4|webm|ogv|m4v|mov)$/i;
const ID = /^[A-Za-z0-9_-]{4,}$/;
/**
 * Turns any pasted https video link into something safe to show, or null (empty, malformed, not https, or carrying a
 * username/password). Known sites (YouTube, Vimeo, Google Drive, Dailymotion, Facebook, Instagram, TikTok, Streamable, Loom)
 * are embedded from their own player address. Direct files (.mp4 .webm .ogv .m4v .mov) are played with <video>.
 * EVERY OTHER https link is accepted as provider 'link': it is opened on its own site and is never put in an iframe.
 */
export function parseVideoUrl(input: string): ParsedVideo | null {
  let u: URL;
  try { u = new URL((input || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const mk = (provider: VideoProvider, id: string, embedUrl: string, watchUrl: string, label: string, thumbUrl: string | null = null): ParsedVideo => ({ provider, id, embedUrl, watchUrl, thumbUrl, label });

  if (YT.test(u.hostname) || host === 'youtu.be') {
    const id = host === 'youtu.be' ? seg[0] : u.pathname === '/watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(seg[0] ?? '') ? seg[1] : null;
    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return mk('youtube', id, `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`, `https://www.youtube.com/watch?v=${id}`, 'YouTube', `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  } else if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const parts = host === 'player.vimeo.com' ? seg.slice(1) : seg;
    const id = parts.find((x) => /^\d{5,}$/.test(x));
    if (id) {
      const hash = u.searchParams.get('h') || parts[parts.indexOf(id) + 1];
      const h = hash && /^[a-f0-9]{6,}$/i.test(hash) ? `&h=${hash}` : '';
      return mk('vimeo', id, `https://player.vimeo.com/video/${id}?autoplay=1${h}`, `https://vimeo.com/${id}`, 'Vimeo');
    }
  } else if (host === 'drive.google.com') {
    const i = seg.indexOf('d');
    const id = i >= 0 ? seg[i + 1] : u.searchParams.get('id');
    if (id && /^[A-Za-z0-9_-]{10,}$/.test(id)) return mk('drive', id, `https://drive.google.com/file/d/${id}/preview`, `https://drive.google.com/file/d/${id}/view`, 'Google Drive');
  } else if (host === 'dailymotion.com' || host === 'dai.ly') {
    const id = host === 'dai.ly' ? seg[0] : seg[0] === 'video' ? seg[1]?.split('_')[0] : undefined;
    if (id && /^[a-z0-9]{5,}$/i.test(id)) return mk('dailymotion', id, `https://www.dailymotion.com/embed/video/${id}?autoplay=1`, `https://www.dailymotion.com/video/${id}`, 'Dailymotion');
  } else if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.watch') {
    if (host === 'fb.watch' ? seg.length > 0 : /(^|\/)(videos?|watch|reel)(\/|$)/.test(u.pathname) || u.pathname.includes('/videos/')) {
      return mk('facebook', u.pathname, `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u.toString())}&show_text=false&autoplay=1`, u.toString(), 'Facebook');
    }
  } else if (host === 'instagram.com') {
    const kind = seg[0]; const code = seg[1];
    if (['reel', 'reels', 'p', 'tv'].includes(kind ?? '') && code && ID.test(code)) { const k = kind === 'reels' ? 'reel' : kind!; return mk('instagram', code, `https://www.instagram.com/${k}/${code}/embed`, `https://www.instagram.com/${k}/${code}/`, 'Instagram'); }
  } else if (host === 'tiktok.com') {
    const i = seg.indexOf('video'); const id = i >= 0 ? seg[i + 1] : undefined;
    if (id && /^\d{8,}$/.test(id)) return mk('tiktok', id, `https://www.tiktok.com/embed/v2/${id}`, u.toString(), 'TikTok');
  } else if (host === 'streamable.com') {
    const id = seg[0] === 'e' || seg[0] === 'o' ? seg[1] : seg[0];
    if (id && /^[a-z0-9]{4,}$/i.test(id)) return mk('streamable', id, `https://streamable.com/e/${id}`, `https://streamable.com/${id}`, 'Streamable');
  } else if (host === 'loom.com') {
    const id = seg[0] === 'share' || seg[0] === 'embed' ? seg[1] : undefined;
    if (id && /^[a-f0-9]{16,}$/i.test(id)) return mk('loom', id, `https://www.loom.com/embed/${id}`, `https://www.loom.com/share/${id}`, 'Loom');
  }
  if (DIRECT.test(u.pathname)) return mk('direct', u.pathname, u.toString(), u.toString(), 'Video file');
  return mk('link', u.toString(), '', u.toString(), host);
}

/* -------------------------------------------------------------- posts */
export interface SpotlightPost {
  id: string; type: 'image' | 'video' | 'text'; category?: string; title: string; caption?: string; body?: string;
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
  category: z.string().optional(),
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
    else if (!parseVideoUrl(v.videoUrl)) issue('videoUrl', 'Use a full https:// video link (no username or password in it).');
  }
  if (v.type === 'text' && !(v.body && v.body.replace(/<[^>]*>/g, '').trim())) issue('body', 'Write the post text.');
});

/* ------------------------------------------------------------ categories */
export const SPOTLIGHT_CATEGORIES = [
  { value: 'events', label: 'School Events' }, { value: 'academics', label: 'Academics & Learning' }, { value: 'student-life', label: 'Student Life' },
  { value: 'sports-arts', label: 'Sports & Arts' }, { value: 'islamic', label: 'Islamic & Character' }, { value: 'community', label: 'Parents & Community' },
  { value: 'announcements', label: 'Announcements' }, { value: 'other', label: 'Other' },
] as const;
/** Posts saved before categories existed (or with an unknown value) count as 'other'. Nothing is rewritten. */
export const categoryOf = (p: { category?: string }): string => (SPOTLIGHT_CATEGORIES.some((c) => c.value === p.category) ? (p.category as string) : 'other');
export const categoryLabel = (v: string) => SPOTLIGHT_CATEGORIES.find((c) => c.value === v)?.label ?? 'Other';
/** Categories that actually have posts, in the fixed order, with counts. */
export function categoriesInUse(posts: { category?: string }[]): { value: string; label: string; count: number }[] {
  return SPOTLIGHT_CATEGORIES.map((c) => ({ value: c.value as string, label: c.label as string, count: posts.filter((p) => categoryOf(p) === c.value).length })).filter((c) => c.count > 0);
}
