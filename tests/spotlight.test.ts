import { describe, it, expect } from 'vitest';
import { cardImage, categoriesInUse, categoryLabel, categoryOf, homepagePosts, parseVideoUrl, spotlightSchema, stepIndex, swipeDir, visiblePosts, type SpotlightPost } from '../src/lib/spotlight';

describe('video url allowlist', () => {
  it('YouTube in every common shape', () => {
    for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ?t=4', 'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=x', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ']) {
      const p = parseVideoUrl(u); expect(p?.provider).toBe('youtube'); expect(p?.id).toBe('dQw4w9WgXcQ');
      expect(p?.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(true);
      expect(p?.thumbUrl).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    }
  });
  it('Vimeo (including unlisted hash), Drive and direct files', () => {
    expect(parseVideoUrl('https://vimeo.com/123456789')?.embedUrl).toBe('https://player.vimeo.com/video/123456789?autoplay=1');
    expect(parseVideoUrl('https://vimeo.com/123456789/abcdef1234')?.embedUrl).toBe('https://player.vimeo.com/video/123456789?autoplay=1&h=abcdef1234');
    expect(parseVideoUrl('https://player.vimeo.com/video/123456789?h=abcdef1234')?.id).toBe('123456789');
    expect(parseVideoUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/view?usp=sharing')?.embedUrl).toBe('https://drive.google.com/file/d/1AbCdEfGhIjKlMn/preview');
    expect(parseVideoUrl('https://cdn.example.org/a/b/lesson.mp4')?.provider).toBe('direct');
  });
  it('rejects only what cannot be a safe https link', () => {
    for (const u of ['', 'not a url', 'javascript:alert(1)', 'data:text/html,<script>', 'http://youtu.be/dQw4w9WgXcQ', 'https://user:pw@x.com/a.mp4', 'ftp://x.com/a.mp4'])
      expect(parseVideoUrl(u)).toBe(null);
  });
  it('accepts every other https link, but never frames an unknown site', () => {
    for (const u of ['https://evil.com/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://vimeo.com/abc', 'https://drive.google.com/drive/folders/xyz', 'https://example.com/page.html', 'https://x.com/someone/status/123']) {
      const v = parseVideoUrl(u);
      expect(v?.provider).toBe('link'); expect(v?.embedUrl).toBe(''); expect(v?.watchUrl).toBe(u);
    }
    expect(parseVideoUrl('https://www.example.com/a')?.label).toBe('example.com');
  });
  it('embeds more known sites and more file types', () => {
    expect(parseVideoUrl('https://www.dailymotion.com/video/x8abcd1_title')?.embedUrl).toBe('https://www.dailymotion.com/embed/video/x8abcd1?autoplay=1');
    expect(parseVideoUrl('https://dai.ly/x8abcd1')?.provider).toBe('dailymotion');
    expect(parseVideoUrl('https://streamable.com/abc12')?.embedUrl).toBe('https://streamable.com/e/abc12');
    expect(parseVideoUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.provider).toBe('loom');
    expect(parseVideoUrl('https://www.tiktok.com/@ela/video/7234567890123456789')?.embedUrl).toBe('https://www.tiktok.com/embed/v2/7234567890123456789');
    expect(parseVideoUrl('https://www.instagram.com/reel/Cabc123/?igsh=x')?.embedUrl).toBe('https://www.instagram.com/reel/Cabc123/embed');
    expect(parseVideoUrl('https://www.facebook.com/page/videos/123456')?.provider).toBe('facebook');
    expect(parseVideoUrl('https://www.facebook.com/page/posts/123')?.provider).toBe('link');
    for (const f of ['a.webm', 'a.MOV', 'a.m4v', 'a.ogv', 'a.mp4?x=1']) expect(parseVideoUrl('https://cdn.example.org/' + f)?.provider).toBe('direct');
  });
});
describe('spotlight categories', () => {
  it('old or unknown categories count as other; only used categories are listed', () => {
    expect(categoryOf({})).toBe('other'); expect(categoryOf({ category: 'zzz' })).toBe('other'); expect(categoryOf({ category: 'events' })).toBe('events');
    const used = categoriesInUse([{ category: 'events' }, {}, { category: 'events' }, { category: 'islamic' }]);
    expect(used.map((c) => `${c.value}:${c.count}`)).toEqual(['events:2', 'islamic:1', 'other:1']);
    expect(categoryLabel('islamic')).toBe('Islamic & Character');
  });
});
const P = (id: string, o: Partial<SpotlightPost> = {}): SpotlightPost => ({ id, type: 'text', title: id, status: 'published', publishedAtMs: 1000, ...o });
describe('post ordering', () => {
  it('shows only published, due posts; featured then order then newest', () => {
    const list = [P('draft', { status: 'draft' }), P('future', { publishedAtMs: 9e12 }), P('old', { publishedAtMs: 1 }), P('new', { publishedAtMs: 5 }), P('ord1', { order: 1, publishedAtMs: 0 }), P('feat', { featured: true, publishedAtMs: 0, order: 50 })];
    expect(visiblePosts(list, 100).map((p) => p.id)).toEqual(['feat', 'ord1', 'new', 'old']);
    expect(homepagePosts(list, 2, 100).map((p) => p.id)).toEqual(['feat', 'ord1']);
  });
  it('card image falls back sensibly', () => {
    expect(cardImage(P('a', { type: 'image', imageUrl: 'https://i/x.jpg' }))).toBe('https://i/x.jpg');
    expect(cardImage(P('a', { type: 'image', imageUrl: 'https://i/x.jpg', thumbnailUrl: 'https://i/t.jpg' }))).toBe('https://i/t.jpg');
    expect(cardImage(P('v', { type: 'video', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }))).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
    expect(cardImage(P('v', { type: 'video', videoUrl: 'https://vimeo.com/123456789' }))).toBe(null);
    expect(cardImage(P('t'))).toBe(null);
  });
});
describe('navigation helpers', () => {
  it('wraps and handles empty lists', () => { expect(stepIndex(0, -1, 4)).toBe(3); expect(stepIndex(3, 1, 4)).toBe(0); expect(stepIndex(0, 1, 0)).toBe(0); });
  it('swipe: vertical drags only', () => { expect(swipeDir(0, -80)).toBe(1); expect(swipeDir(0, 80)).toBe(-1); expect(swipeDir(0, 20)).toBe(0); expect(swipeDir(90, 60)).toBe(0); });
});
describe('cms validation', () => {
  const ok = (v: object) => spotlightSchema.safeParse(v).success;
  it('requires the right media per type', () => {
    expect(ok({ type: 'image', title: 'Hello', imageUrl: 'https://a/b.jpg' })).toBe(true);
    expect(ok({ type: 'image', title: 'Hello' })).toBe(false);
    expect(ok({ type: 'image', title: 'Hello', imageUrl: 'http://a/b.jpg' })).toBe(false);
    expect(ok({ type: 'video', title: 'Hello', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).toBe(true);
    expect(ok({ type: 'video', title: 'Hello', videoUrl: 'https://evil.com/x' })).toBe(true); // any https link is accepted (opened on its own site)
    expect(ok({ type: 'video', title: 'Hello', videoUrl: 'http://evil.com/x.mp4' })).toBe(false);
    expect(ok({ type: 'video', title: 'Hello', videoUrl: 'javascript:alert(1)' })).toBe(false);
    expect(ok({ type: 'video', title: 'Hello', category: 'events', videoUrl: 'https://youtu.be/dQw4w9WgXcQ' })).toBe(true);
    expect(ok({ type: 'text', title: 'Hello', body: '<p> </p>' })).toBe(false);
    expect(ok({ type: 'text', title: 'Hello', body: '<p>Real text</p>' })).toBe(true);
  });
});
