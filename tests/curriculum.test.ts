import { describe, it, expect } from 'vitest';
import { buildTree, canTransition, duplicatePlan, moveWithin, nextOrder, schemeProblems, schemeToCsvRows, schemeToHtml, topicProblems, unplanned, type SchemeRow, type Topic } from '../src/lib/curriculum';

const T = (id: string, parentId: string, title: string, order: number): Topic => ({ id, curriculumId: 'c1', parentId, title, order });
const topics = [T('a', '', 'Algebra', 1), T('a1', 'a', 'Expressions', 2), T('a2', 'a', 'Equations', 1), T('g', '', 'Geometry', 2)];
const R = (id: string, week: number, topicId: string, subtopicId = '', o: Partial<SchemeRow> = {}): SchemeRow => ({ id, curriculumId: 'c1', termId: 't1', week, topicId, subtopicId, objectives: '', activities: '', materials: '', assessment: '', outcomes: '', teacherUid: '', ...o });

describe('topic tree', () => {
  it('builds topic → subtopic order', () => {
    const t = buildTree(topics);
    expect(t.map((n) => n.topic.id)).toEqual(['a', 'g']);
    expect(t[0].children.map((c) => c.id)).toEqual(['a2', 'a1']);
    expect(nextOrder(t[0].children)).toBe(3); expect(nextOrder([])).toBe(1);
  });
  it('moves items and stops at the ends', () => {
    const kids = topics.filter((x) => x.parentId === 'a');
    const u = moveWithin(kids, 'a1', -1);
    expect(u.find((x) => x.id === 'a1')!.order).toBe(1); expect(u.find((x) => x.id === 'a2')!.order).toBe(2);
    expect(moveWithin(kids, 'a2', -1)).toEqual([]); expect(moveWithin(kids, 'a1', 1)).toEqual([]);
    const same = [T('x', '', 'X', 1), T('y', '', 'Y', 1)];
    expect(moveWithin(same, 'y', -1).length > 0).toBe(true); // equal orders still move
  });
  it('validates depth, duplicates and missing parents', () => {
    expect(topicProblems({ parentId: '', title: 'algebra' }, topics).length).toBe(1);
    expect(topicProblems({ parentId: 'a1', title: 'Deep' }, topics).length).toBe(1);
    expect(topicProblems({ parentId: 'zzz', title: 'Orphan' }, topics).length).toBe(1);
    expect(topicProblems({ id: 'a', parentId: 'g', title: 'Algebra' }, topics).length).toBe(1);
    expect(topicProblems({ parentId: 'a', title: 'New sub' }, topics)).toEqual([]);
    expect(topicProblems({ parentId: '', title: '  ' }, topics).length).toBe(1);
  });
});
describe('scheme of work', () => {
  it('validates weeks, topic/subtopic pairing and duplicates', () => {
    const rows = [R('r1', 1, 'a', 'a2')];
    expect(schemeProblems({ id: 'n', week: 0, topicId: 'a', subtopicId: '', termId: 't1' }, rows, topics).length).toBe(1);
    expect(schemeProblems({ id: 'n', week: 21, topicId: 'a', subtopicId: '', termId: 't1' }, rows, topics).length).toBe(1);
    expect(schemeProblems({ id: 'n', week: 2, topicId: 'g', subtopicId: 'a1', termId: 't1' }, rows, topics).length).toBe(1);
    expect(schemeProblems({ id: 'n', week: 2, topicId: 'a1', subtopicId: '', termId: 't1' }, rows, topics).length).toBe(1);
    expect(schemeProblems({ id: 'n', week: 1, topicId: 'a', subtopicId: 'a2', termId: 't1' }, rows, topics).length).toBe(1);
    expect(schemeProblems({ id: 'r1', week: 1, topicId: 'a', subtopicId: 'a2', termId: 't1' }, rows, topics)).toEqual([]); // editing itself is fine
    expect(schemeProblems({ id: 'n', week: 1, topicId: 'a', subtopicId: 'a2', termId: 't2' }, rows, topics)).toEqual([]); // other term
  });
  it('lists what is not planned yet', () => {
    expect(unplanned(topics, []).map((t) => t.id)).toEqual(['a2', 'a1', 'g']);
    expect(unplanned(topics, [R('r1', 1, 'a', 'a2'), R('r2', 2, 'g')]).map((t) => t.id)).toEqual(['a1']);
  });
  it('status workflow', () => { expect(canTransition('draft', 'published')).toBe(true); expect(canTransition('archived', 'published')).toBe(false); expect(canTransition('archived', 'draft')).toBe(true); });
});
describe('duplication', () => {
  it('copies everything with new, consistent ids and starts as a draft', () => {
    let n = 0; const id = () => `new${++n}`;
    const p = duplicatePlan({ title: 'Maths', status: 'published' }, topics, [R('r1', 1, 'a', 'a2'), R('r2', 3, 'g')], id);
    expect(p.curriculum.title).toBe('Maths (copy)'); expect(p.curriculum.status).toBe('draft');
    expect(new Set([p.curriculumId, ...p.topics.map((t) => t.id), ...p.rows.map((r) => r.id)]).size).toBe(1 + 4 + 2);
    const newA = p.topics.find((t) => t.title === 'Algebra')!, newA2 = p.topics.find((t) => t.title === 'Equations')!;
    expect(newA2.parentId).toBe(newA.id); expect(p.topics.every((t) => t.curriculumId === p.curriculumId)).toBe(true);
    expect(p.rows[0].topicId).toBe(newA.id); expect(p.rows[0].subtopicId).toBe(newA2.id);
    expect(topics.find((t) => t.id === 'a')!.curriculumId).toBe('c1'); // original untouched
  });
});
describe('export', () => {
  it('escapes HTML in the printable scheme and keeps week order', () => {
    const html = schemeToHtml({ school: 'ELA', title: 'Maths <b>', className: 'JSS 1', subjectName: 'Maths', termName: 'T1', teachers: 'Mr A' }, [R('r2', 2, 'g'), R('r1', 1, 'a', 'a2', { activities: '<script>alert(1)</script>' })], topics);
    expect(html.includes('<script>alert')).toBe(false); expect(html.includes('&lt;script&gt;')).toBe(true); expect(html.includes('Maths &lt;b&gt;')).toBe(true);
    expect(html.indexOf('Algebra') < html.indexOf('Geometry')).toBe(true);
  });
  it('csv has a header and one line per week entry', () => {
    const c = schemeToCsvRows([R('r1', 1, 'a', 'a2')], topics);
    expect(c.length).toBe(2); expect(c[1][1]).toBe('Algebra'); expect(c[1][2]).toBe('Equations');
  });
});
