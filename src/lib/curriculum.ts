/** Pure rules for ELA Curriculum Studio: topic tree, scheme of work, duplication, export. Unit-tested. */
export type CurriculumStatus = 'draft' | 'published' | 'archived';
export interface Topic { id: string; curriculumId: string; parentId: string; title: string; order: number; objectives?: string; outcomes?: string; durationMin?: number }
export interface SchemeRow {
  id: string; curriculumId: string; termId: string; week: number; topicId: string; subtopicId: string;
  objectives: string; activities: string; materials: string; assessment: string; outcomes: string; teacherUid: string; teacherName?: string; notes?: string;
}
export interface TreeNode { topic: Topic; children: Topic[] }
export const MAX_WEEKS = 20;

export const LEVELS = ['Early Years', 'Primary', 'Junior Secondary (JSS)', 'Senior Secondary (SSS)', 'Islamic Studies', 'Vocational / Skills', 'Adult Learning', 'Other'];

const byOrder = (a: Topic, b: Topic) => a.order - b.order || a.title.localeCompare(b.title);
/** Topics (parentId '') with their subtopics, both sorted. */
export function buildTree(topics: Topic[]): TreeNode[] {
  const tops = topics.filter((t) => !t.parentId).sort(byOrder);
  return tops.map((t) => ({ topic: t, children: topics.filter((c) => c.parentId === t.id).sort(byOrder) }));
}
export const nextOrder = (siblings: Topic[]) => siblings.reduce((m, t) => Math.max(m, t.order), 0) + 1;
/** Moving one step up/down: returns the {id, order} updates (swap with neighbour), [] at the ends. */
export function moveWithin(siblings: Topic[], id: string, dir: -1 | 1): Array<{ id: string; order: number }> {
  const s = [...siblings].sort(byOrder); const i = s.findIndex((t) => t.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= s.length) return [];
  const a = s[i], b = s[j];
  // re-number to 1..n first so equal orders can never make a swap a no-op
  const ord = new Map(s.map((t, k) => [t.id, k + 1]));
  ord.set(a.id, j + 1); ord.set(b.id, i + 1);
  return s.map((t) => ({ id: t.id, order: ord.get(t.id)! })).filter((u) => u.order !== s.find((t) => t.id === u.id)!.order);
}
/** Problems with a topic/subtopic about to be saved. */
export function topicProblems(t: { id?: string; parentId: string; title: string }, all: Topic[]): string[] {
  const out: string[] = []; const title = t.title.trim().toLowerCase();
  if (!title) out.push('Enter a title.');
  if (t.parentId) {
    const p = all.find((x) => x.id === t.parentId);
    if (!p) out.push('The parent topic no longer exists.'); else if (p.parentId) out.push('A subtopic cannot have its own subtopics (topic → subtopic only).');
    if (t.id && all.some((x) => x.parentId === t.id)) out.push('This topic has subtopics, so it cannot become a subtopic.');
  }
  if (all.some((x) => x.id !== t.id && x.parentId === t.parentId && x.title.trim().toLowerCase() === title)) out.push('Another item with this title already exists here.');
  return out;
}

/** Problems with a scheme-of-work row. Errors block saving; the duplicate is reported too. */
export function schemeProblems(r: Pick<SchemeRow, 'id' | 'week' | 'topicId' | 'subtopicId' | 'termId'>, rows: SchemeRow[], topics: Topic[], maxWeeks = MAX_WEEKS): string[] {
  const out: string[] = [];
  if (!Number.isInteger(r.week) || r.week < 1 || r.week > maxWeeks) out.push(`Week must be a whole number from 1 to ${maxWeeks}.`);
  const top = topics.find((t) => t.id === r.topicId);
  if (!top || top.parentId) out.push('Choose a topic.');
  if (r.subtopicId) { const s = topics.find((t) => t.id === r.subtopicId); if (!s || s.parentId !== r.topicId) out.push('That subtopic does not belong to the chosen topic.'); }
  if (rows.some((x) => x.id !== r.id && x.termId === r.termId && x.week === r.week && x.topicId === r.topicId && x.subtopicId === r.subtopicId)) out.push('This topic is already planned for that week.');
  return out;
}
/** Topics/subtopics of a curriculum that are not yet planned in any week of the chosen term. */
export function unplanned(topics: Topic[], rows: SchemeRow[]): Topic[] {
  const used = new Set(rows.flatMap((r) => [r.topicId, r.subtopicId].filter(Boolean)));
  const tree = buildTree(topics);
  const out: Topic[] = [];
  for (const n of tree) {
    if (n.children.length) n.children.forEach((c) => { if (!used.has(c.id)) out.push(c); });
    else if (!used.has(n.topic.id)) out.push(n.topic);
  }
  return out;
}
export const sortRows = (rows: SchemeRow[]) => [...rows].sort((a, b) => a.week - b.week || a.topicId.localeCompare(b.topicId) || a.subtopicId.localeCompare(b.subtopicId));

const ALLOWED: Record<CurriculumStatus, CurriculumStatus[]> = { draft: ['published', 'archived'], published: ['archived', 'draft'], archived: ['draft'] };
export const canTransition = (from: CurriculumStatus, to: CurriculumStatus) => from === to || ALLOWED[from].includes(to);

/** Copy a curriculum with fresh ids; parent/topic/subtopic links are remapped so the copy is independent. */
export function duplicatePlan<C extends { title: string; status: string }>(c: C, topics: Topic[], rows: SchemeRow[], newId: () => string) {
  const curriculumId = newId();
  const map = new Map<string, string>(); topics.forEach((t) => map.set(t.id, newId()));
  const m = (id: string) => (id ? map.get(id) ?? '' : '');
  return {
    curriculumId,
    curriculum: { ...c, title: `${c.title} (copy)`, status: 'draft' as const },
    topics: topics.map((t) => ({ ...t, id: map.get(t.id)!, curriculumId, parentId: m(t.parentId) })),
    rows: rows.map((r) => ({ ...r, id: newId(), curriculumId, topicId: m(r.topicId), subtopicId: m(r.subtopicId) })),
  };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export interface SchemeMeta { school: string; title: string; className: string; subjectName: string; termName: string; teachers: string }
/** Standalone printable page (opened in a new window; the browser's Print → Save as PDF). All text is escaped. */
export function schemeToHtml(meta: SchemeMeta, rows: SchemeRow[], topics: Topic[]): string {
  const name = (id: string) => topics.find((t) => t.id === id)?.title ?? '';
  const body = sortRows(rows).map((r) => `<tr><td>${r.week}</td><td><b>${esc(name(r.topicId))}</b>${r.subtopicId ? `<br>${esc(name(r.subtopicId))}` : ''}</td><td>${esc(r.objectives)}</td><td>${esc(r.activities)}</td><td>${esc(r.materials)}</td><td>${esc(r.assessment)}</td><td>${esc(r.outcomes)}</td><td>${esc(r.teacherName ?? '')}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.title)} — Scheme of work</title><style>
body{font-family:Inter,Arial,sans-serif;color:#1a1a1a;margin:24px}h1{font-size:18px;margin:0;color:#0B3D2E}h2{font-size:14px;margin:4px 0 12px;font-weight:600}
.meta{font-size:12px;margin-bottom:12px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #999;padding:5px;vertical-align:top;text-align:left}th{background:#0B3D2E;color:#fff}
tr{page-break-inside:avoid}@media print{@page{size:A4 landscape;margin:12mm}}</style></head><body>
<h1>${esc(meta.school)}</h1><h2>Scheme of Work — ${esc(meta.title)}</h2>
<div class="meta"><b>Class:</b> ${esc(meta.className)} &nbsp; <b>Subject:</b> ${esc(meta.subjectName)} &nbsp; <b>Term:</b> ${esc(meta.termName)} &nbsp; <b>Teacher(s):</b> ${esc(meta.teachers)}</div>
<table><thead><tr><th>Week</th><th>Topic / Subtopic</th><th>Learning objectives</th><th>Teaching activities</th><th>Instructional materials</th><th>Assessment</th><th>Expected outcomes</th><th>Teacher</th></tr></thead><tbody>${body || '<tr><td colspan="8">No weeks planned yet.</td></tr>'}</tbody></table></body></html>`;
}
export function schemeToCsvRows(rows: SchemeRow[], topics: Topic[]): string[][] {
  const name = (id: string) => topics.find((t) => t.id === id)?.title ?? '';
  return [['Week', 'Topic', 'Subtopic', 'Learning objectives', 'Teaching activities', 'Instructional materials', 'Assessment', 'Expected outcomes', 'Teacher'],
    ...sortRows(rows).map((r) => [String(r.week), name(r.topicId), name(r.subtopicId), r.objectives, r.activities, r.materials, r.assessment, r.outcomes, r.teacherName ?? ''])];
}
