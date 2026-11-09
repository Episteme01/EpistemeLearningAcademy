import type { MediaKind, Resource } from '@/types/models';

export const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', audio: 'Audio', video: 'Video', document: 'Document', link: 'Link' };

/** "algebra, Week 3 ,algebra" -> ["algebra","week 3"] (lower-case, de-duplicated, max 20, 30 chars each). */
export function normaliseTags(input: string | string[]): string[] {
  const parts = Array.isArray(input) ? input : input.split(/[,\n]/);
  return [...new Set(parts.map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 20);
}

/** YouTube video id from watch / youtu.be / embed / shorts URLs, else null. */
export function youtubeId(url: string): string | null {
  const m = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url.trim());
  return m ? m[1]! : null;
}

/** Best guess of what an external link is, so it gets a sensible icon and player. */
export function kindFromUrl(url: string): MediaKind {
  const u = url.toLowerCase().split('?')[0]!;
  if (youtubeId(url) || /vimeo\.com/.test(u) || /\.(mp4|webm|mov)$/.test(u)) return 'video';
  if (/\.(mp3|m4a|wav|ogg|aac)$/.test(u)) return 'audio';
  if (/\.(png|jpe?g|gif|webp)$/.test(u)) return 'image';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt)$/.test(u) || /docs\.google\.com|drive\.google\.com/.test(u)) return 'document';
  return 'link';
}

export interface ResourceFilter { q?: string; kind?: MediaKind | ''; subject?: string; classId?: string; courseId?: string; tag?: string; published?: 'yes' | 'no' | '' }

/** Client-side filtering. Items with no class/course are general and match every class/course filter. */
export function filterResources<T extends Pick<Resource, 'title' | 'description' | 'fileKind' | 'subject' | 'classId' | 'courseId' | 'tags' | 'published'>>(list: T[], f: ResourceFilter): T[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return list.filter((r) => {
    if (f.kind && r.fileKind !== f.kind) return false;
    if (f.subject && (r.subject ?? '').toLowerCase() !== f.subject.toLowerCase()) return false;
    if (f.classId && r.classId && r.classId !== f.classId) return false;
    if (f.courseId && r.courseId && r.courseId !== f.courseId) return false;
    if (f.tag && !r.tags.includes(f.tag)) return false;
    if (f.published === 'yes' && !r.published) return false;
    if (f.published === 'no' && r.published) return false;
    if (q && !`${r.title} ${r.description ?? ''} ${r.subject ?? ''} ${r.tags.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
