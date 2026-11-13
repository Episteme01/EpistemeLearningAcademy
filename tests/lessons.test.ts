import { describe, it, expect } from 'vitest';
import { allowedTransitions, canEditContent, chooseDraft, hasText, isDirty, lessonToHtml, submitProblems, wordCount, type LessonDoc } from '../src/lib/lessons';

const A = { leader: false, author: true }, L = { leader: true, author: false }, X = { leader: false, author: false };
describe('lesson workflow', () => {
  it('author submits; only leaders approve and publish', () => {
    expect(allowedTransitions('draft', A)).toEqual(['review']);
    expect(allowedTransitions('review', A)).toEqual(['draft']);
    expect(allowedTransitions('review', L).sort()).toEqual(['approved', 'draft']);
    expect(allowedTransitions('approved', A)).toEqual([]);
    expect(allowedTransitions('approved', L).sort()).toEqual(['draft', 'published']);
    expect(allowedTransitions('published', L).sort()).toEqual(['approved', 'archived']);
    expect(allowedTransitions('archived', L)).toEqual(['draft']);
    expect(allowedTransitions('draft', X)).toEqual([]);
    expect(allowedTransitions('published', A)).toEqual([]);
  });
  it('who may edit', () => {
    expect(canEditContent('draft', A)).toBe(true); expect(canEditContent('review', A)).toBe(false); expect(canEditContent('published', A)).toBe(false);
    expect(canEditContent('published', L)).toBe(true); expect(canEditContent('archived', L)).toBe(false); expect(canEditContent('draft', X)).toBe(false);
  });
});
const ok: LessonDoc = { title: 'Fractions', status: 'draft', subjectId: 's', durationMin: 40, objectives: ['Add fractions'], presentation: '<p>Body</p>' };
describe('submission checks', () => {
  it('passes a complete lesson and lists every gap otherwise', () => {
    expect(submitProblems(ok)).toEqual([]);
    expect(submitProblems({ ...ok, title: ' ', subjectId: '', durationMin: 1, objectives: [' '], presentation: '<p> </p>' }).length).toBe(5);
    expect(hasText('<p>&nbsp;</p>')).toBe(false); expect(hasText('<img src="https://x/y.png">')).toBe(true);
    expect(wordCount({ presentation: '<p>one two three</p>', conclusion: '<b>four</b>' })).toBe(4);
  });
});
describe('draft recovery', () => {
  it('restores a newer, different local copy only', () => {
    const remote = { title: 'A' };
    expect(chooseDraft(null, 100, remote)).toBe('remote');
    expect(chooseDraft({ savedAt: 50, data: { title: 'B' } }, 100, remote)).toBe('remote');
    expect(chooseDraft({ savedAt: 150, data: { title: 'B' } }, 100, remote)).toBe('local');
    expect(chooseDraft({ savedAt: 150, data: { title: 'A' } }, 100, remote)).toBe('remote');
    expect(isDirty({ a: 1 }, { a: 1 })).toBe(false); expect(isDirty({ a: 1 }, { a: 2 })).toBe(true);
  });
});
describe('printable lesson', () => {
  it('escapes plain fields, runs rich text through the sanitiser and hides the guide unless asked', () => {
    const l = { ...ok, title: 'T <script>x</script>', objectives: ['<b>obj</b>'], presentation: '<p>safe</p><script>bad()</script>' };
    const clean = (h: string) => h.replace(/<script[\s\S]*?<\/script>/g, '');
    const html = lessonToHtml(l, { school: 'ELA', className: 'JSS1', subjectName: 'Maths', teacherName: 'Mr A', topic: 'Fractions', week: 3 }, clean);
    expect(html.includes('<script>')).toBe(false); expect(html.includes('&lt;b&gt;obj')).toBe(true); expect(html.includes('<p>safe</p>')).toBe(true);
    expect(html.includes('Teacher guide')).toBe(false);
    const g = lessonToHtml(l, { school: 'ELA', className: '', subjectName: '', teacherName: '', topic: '' }, clean, { expectedAnswers: '<p>Answer 42</p>' });
    expect(g.includes('Teacher guide') && g.includes('Answer 42')).toBe(true);
  });
});
