/** Helpers for the Islamic dashboard picture preview / download (pure, unit-tested). */
export function safeFileName(title: string, url: string): string {
  const ext = (/\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i.exec(url.split('?')[0] + '?')?.[1] ?? 'jpg').toLowerCase();
  const base = (title || 'picture').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60).replace(/^-+|-+$/g, '') || 'picture';
  return `${base}.${ext}`;
}
/** Cloudinary can force a download itself (fl_attachment); used when the browser cannot fetch the picture directly. */
export function attachmentUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'res.cloudinary.com' || !u.pathname.includes('/upload/') || u.pathname.includes('/fl_attachment')) return null;
    u.pathname = u.pathname.replace('/upload/', '/upload/fl_attachment/');
    return u.toString();
  } catch { return null; }
}
