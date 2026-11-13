import { it, expect } from 'vitest';
import { addPlayed, canComplete, clampPage, courseSummary, daysSince, googleSlidesEmbed, packRanges, pdfSrc, presentationKind, stepZoom, summariseChild, unpackRanges, watchedPct } from '../src/lib/learning';

it('google slides embed accepts only docs.google.com presentations', () => {
  expect(googleSlidesEmbed('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit#slide=id.p')).toBe('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/embed?start=false&loop=false');
  expect(googleSlidesEmbed('https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGh/pub?start=true')).toBe('https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGh/embed?start=false&loop=false');
  for (const bad of ['http://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit', 'https://evil.com/presentation/d/1AbCdEfGhIjKlMn', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMn', 'javascript:alert(1)', '']) expect(googleSlidesEmbed(bad)).toBe(null);
});
it('presentation kinds', () => {
  expect(presentationKind({ fileName: 'Week3.PDF' })).toBe('pdf');
  expect(presentationKind({ contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })).toBe('pptx');
  expect(presentationKind({ fileName: 'a.ppt' })).toBe('pptx');
  expect(presentationKind({ url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit' })).toBe('slides');
  expect(presentationKind({ fileName: 'a.docx' })).toBe('other');
});
it('zoom, page and pdf src', () => {
  expect(stepZoom(100, 1)).toBe(125); expect(stepZoom(100, -1)).toBe(75); expect(stepZoom(200, 1)).toBe(200); expect(stepZoom(50, -1)).toBe(50);
  expect(clampPage(0)).toBe(1); expect(clampPage(9, 5)).toBe(5); expect(clampPage(NaN)).toBe(1);
  expect(pdfSrc('https://x.test/a.pdf?t=1#page=4', 2, 125)).toBe('https://x.test/a.pdf?t=1#page=2&zoom=125');
});
it('watch tracking counts real playback only', () => {
  let r = addPlayed([], 0, 1); r = addPlayed(r, 1, 2); r = addPlayed(r, 2, 3);
  expect(r).toEqual([[0, 3]]);
  r = addPlayed(r, 50, 80); // a seek, not playback
  expect(r).toEqual([[0, 3]]);
  r = addPlayed(r, 10, 11);
  expect(watchedPct(r, 100)).toBe(4);
  r = addPlayed(r, 0, 1.5); // replaying does not double count
  expect(watchedPct(r, 100)).toBe(4);
  expect(watchedPct([], 0)).toBe(0);
});
it('range packing is safe against bad data', () => {
  expect(unpackRanges([[0, 5], [3], 'x', [5, 2], [1, NaN]])).toEqual([[0, 5]]);
  expect(packRanges([[0.2, 4.1]])).toEqual([[0, 5]]);
  expect(unpackRanges(null)).toEqual([]);
});
it('completion rules never complete on open', () => {
  expect(canComplete('watch', { trackable: true, watchedPct: 0 }).ok).toBe(false);
  expect(canComplete('watch', { trackable: true, watchedPct: 89 }).ok).toBe(false);
  expect(canComplete('watch', { trackable: true, watchedPct: 90 }).ok).toBe(true);
  expect(canComplete('watch', { trackable: false, watchedPct: 0 }).ok).toBe(true); // cannot be measured: learner confirms
  expect(canComplete('manual', { trackable: true, watchedPct: 0 }).ok).toBe(true);
});
it('course summary', () => {
  expect(courseSummary(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual({ total: 3, done: 2, pct: 67, nextId: 'b' });
  expect(courseSummary([], new Set())).toEqual({ total: 0, done: 0, pct: 0, nextId: null });
});
it('child summary only reflects records', () => {
  const empty = summariseChild([], []);
  expect(empty.hasData).toBe(false); expect(empty.avgProgress).toBe(null); expect(empty.lastActivityMs).toBe(null);
  const s = summariseChild([{ courseId: 'c', courseTitle: 'C', progressPct: 40, completedLessons: 2, lastActivityMs: 1000, status: 'active' }, { courseId: 'd', courseTitle: 'D', progressPct: 60, completedLessons: 3, status: 'active' }], [{ status: 'submitted' }, { status: 'marked', score: 8 }], [5000]);
  expect(s.avgProgress).toBe(50); expect(s.lessonsDone).toBe(5); expect(s.lastActivityMs).toBe(5000); expect(s.submitted).toBe(2); expect(s.marked).toBe(1);
  expect(daysSince(null)).toBe(null); expect(daysSince(0, 3 * 86_400_000 + 5)).toBe(3);
});
import { attachmentUrl, safeFileName } from '../src/lib/imageDownload';
it('picture download helpers', () => {
  expect(safeFileName('Jumu’ah Mubarak / 2026!', 'https://x.test/a/b.PNG?v=2')).toBe('Jumuah-Mubarak-2026.png');
  expect(safeFileName('', 'https://x.test/a/noext')).toBe('picture.jpg');
  expect(attachmentUrl('https://res.cloudinary.com/demo/image/upload/v1/a.jpg')).toBe('https://res.cloudinary.com/demo/image/upload/fl_attachment/v1/a.jpg');
  expect(attachmentUrl('https://other.com/upload/a.jpg')).toBe(null);
  expect(attachmentUrl('https://res.cloudinary.com/demo/image/upload/fl_attachment/a.jpg')).toBe(null);
  expect(attachmentUrl('nonsense')).toBe(null);
});
