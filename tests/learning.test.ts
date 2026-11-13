import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addPlayed, canComplete, clampPage, courseSummary, daysSince, googleSlidesEmbed, packRanges, pdfSrc, presentationKind, stepZoom, summariseChild, unpackRanges, watchedPct } from '../src/lib/learning';

test('google slides embed accepts only docs.google.com presentations', () => {
  assert.equal(googleSlidesEmbed('https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit#slide=id.p'), 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/embed?start=false&loop=false');
  assert.equal(googleSlidesEmbed('https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGh/pub?start=true'), 'https://docs.google.com/presentation/d/e/2PACX-1vAbCdEfGh/embed?start=false&loop=false');
  for (const bad of ['http://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit', 'https://evil.com/presentation/d/1AbCdEfGhIjKlMn', 'https://docs.google.com/document/d/1AbCdEfGhIjKlMn', 'javascript:alert(1)', '']) assert.equal(googleSlidesEmbed(bad), null);
});
test('presentation kinds', () => {
  assert.equal(presentationKind({ fileName: 'Week3.PDF' }), 'pdf');
  assert.equal(presentationKind({ contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'pptx');
  assert.equal(presentationKind({ fileName: 'a.ppt' }), 'pptx');
  assert.equal(presentationKind({ url: 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMn/edit' }), 'slides');
  assert.equal(presentationKind({ fileName: 'a.docx' }), 'other');
});
test('zoom, page and pdf src', () => {
  assert.equal(stepZoom(100, 1), 125); assert.equal(stepZoom(100, -1), 75); assert.equal(stepZoom(200, 1), 200); assert.equal(stepZoom(50, -1), 50);
  assert.equal(clampPage(0), 1); assert.equal(clampPage(9, 5), 5); assert.equal(clampPage(NaN), 1);
  assert.equal(pdfSrc('https://x.test/a.pdf?t=1#page=4', 2, 125), 'https://x.test/a.pdf?t=1#page=2&zoom=125');
});
test('watch tracking counts real playback only', () => {
  let r = addPlayed([], 0, 1); r = addPlayed(r, 1, 2); r = addPlayed(r, 2, 3);
  assert.deepEqual(r, [[0, 3]]);
  r = addPlayed(r, 50, 80); // a seek, not playback
  assert.deepEqual(r, [[0, 3]]);
  r = addPlayed(r, 10, 11);
  assert.equal(watchedPct(r, 100), 4);
  r = addPlayed(r, 0, 1.5); // replaying does not double count
  assert.equal(watchedPct(r, 100), 4);
  assert.equal(watchedPct([], 0), 0);
});
test('range packing is safe against bad data', () => {
  assert.deepEqual(unpackRanges([[0, 5], [3], 'x', [5, 2], [1, NaN]]), [[0, 5]]);
  assert.deepEqual(packRanges([[0.2, 4.1]]), [[0, 5]]);
  assert.deepEqual(unpackRanges(null), []);
});
test('completion rules never complete on open', () => {
  assert.equal(canComplete('watch', { trackable: true, watchedPct: 0 }).ok, false);
  assert.equal(canComplete('watch', { trackable: true, watchedPct: 89 }).ok, false);
  assert.equal(canComplete('watch', { trackable: true, watchedPct: 90 }).ok, true);
  assert.equal(canComplete('watch', { trackable: false, watchedPct: 0 }).ok, true); // cannot be measured: learner confirms
  assert.equal(canComplete('manual', { trackable: true, watchedPct: 0 }).ok, true);
});
test('course summary', () => {
  assert.deepEqual(courseSummary(['a', 'b', 'c'], new Set(['a', 'c'])), { total: 3, done: 2, pct: 67, nextId: 'b' });
  assert.deepEqual(courseSummary([], new Set()), { total: 0, done: 0, pct: 0, nextId: null });
});
test('child summary only reflects records', () => {
  const empty = summariseChild([], []);
  assert.equal(empty.hasData, false); assert.equal(empty.avgProgress, null); assert.equal(empty.lastActivityMs, null);
  const s = summariseChild([{ courseId: 'c', courseTitle: 'C', progressPct: 40, completedLessons: 2, lastActivityMs: 1000, status: 'active' }, { courseId: 'd', courseTitle: 'D', progressPct: 60, completedLessons: 3, status: 'active' }], [{ status: 'submitted' }, { status: 'marked', score: 8 }], [5000]);
  assert.equal(s.avgProgress, 50); assert.equal(s.lessonsDone, 5); assert.equal(s.lastActivityMs, 5000); assert.equal(s.submitted, 2); assert.equal(s.marked, 1);
  assert.equal(daysSince(null), null); assert.equal(daysSince(0, 3 * 86_400_000 + 5), 3);
});
import { attachmentUrl, safeFileName } from '../src/lib/imageDownload';
test('picture download helpers', () => {
  assert.equal(safeFileName('Jumu’ah Mubarak / 2026!', 'https://x.test/a/b.PNG?v=2'), 'Jumuah-Mubarak-2026.png');
  assert.equal(safeFileName('', 'https://x.test/a/noext'), 'picture.jpg');
  assert.equal(attachmentUrl('https://res.cloudinary.com/demo/image/upload/v1/a.jpg'), 'https://res.cloudinary.com/demo/image/upload/fl_attachment/v1/a.jpg');
  assert.equal(attachmentUrl('https://other.com/upload/a.jpg'), null);
  assert.equal(attachmentUrl('https://res.cloudinary.com/demo/image/upload/fl_attachment/a.jpg'), null);
  assert.equal(attachmentUrl('nonsense'), null);
});
