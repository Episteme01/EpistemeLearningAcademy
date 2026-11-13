/** Pure rules for the ELA Lesson Authoring Studio (workflow, completeness, draft recovery, printable note). Unit-tested. */
export type LessonStatus = 'draft' | 'review' | 'approved' | 'published' | 'archived';
export const STATUS_LABEL: Record<LessonStatus, string> = { draft: 'Draft', review: 'In review', approved: 'Approved', published: 'Published', archived: 'Archived' };

export const RICH_SECTIONS = [
  ['previousKnowledge', 'Previous knowledge'], ['introduction', 'Introduction'], ['presentation', 'Lesson presentation'],
  ['teacherActivities', 'Teacher activities'], ['learnerActivities', 'Learner activities'], ['examples', 'Examples and illustrations'],
  ['practical', 'Practical activities'], ['assessmentQuestions', 'Assessment questions'], ['assignment', 'Assignment'], ['conclusion', 'Conclusion'],
] as const;
export type RichKey = (typeof RICH_SECTIONS)[number][0];
export const GUIDE_SECTIONS = [
  ['notes', 'Teacher notes'], ['preparation', 'Lesson preparation'], ['teachingGuidance', 'Teaching guidance'], ['expectedAnswers', 'Expected answers'], ['differentiation', 'Differentiation strategies'],
] as const;
export type GuideKey = (typeof GUIDE_SECTIONS)[number][0];

export interface LessonDoc {
  title: string; status: LessonStatus; durationMin?: number; objectives?: string[]; materials?: string[]; references?: string[];
  supplementary?: { title: string; url: string }[]; subjectId?: string; topicId?: string; week?: number;
  [k: string]: unknown;
}

const NEXT: Record<LessonStatus, Array<{ to: LessonStatus; who: 'author' | 'leader' }>> = {
  draft: [{ to: 'review', who: 'author' }, { to: 'archived', who: 'leader' }],
  review: [{ to: 'approved', who: 'leader' }, { to: 'draft', who: 'author' }, { to: 'draft', who: 'leader' }],
  approved: [{ to: 'published', who: 'leader' }, { to: 'draft', who: 'leader' }],
  published: [{ to: 'approved', who: 'leader' }, { to: 'archived', who: 'leader' }],
  archived: [{ to: 'draft', who: 'leader' }],
};
/** Statuses this person may move the lesson to. Leaders (principal/admin/super admin) approve and publish; authors submit. */
export function allowedTransitions(from: LessonStatus, p: { leader: boolean; author: boolean }): LessonStatus[] {
  const out = new Set<LessonStatus>();
  for (const n of NEXT[from]) if ((n.who === 'leader' && p.leader) || (n.who === 'author' && (p.author || p.leader))) out.add(n.to);
  return [...out];
}
/** Content can be edited by the author only while it is a draft; leaders can edit at any stage before archiving. */
export const canEditContent = (status: LessonStatus, p: { leader: boolean; author: boolean }) => (p.leader ? status !== 'archived' : p.author && status === 'draft');

const text = (html: unknown) => String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
export const hasText = (html: unknown) => text(html).length > 0 || /<img\b/i.test(String(html ?? ''));
/** What must be filled in before a lesson can be sent for review. */
export function submitProblems(l: LessonDoc): string[] {
  const out: string[] = [];
  if (!l.title?.trim()) out.push('Add a lesson title.');
  if (!l.subjectId) out.push('Choose the subject.');
  if (!l.durationMin || l.durationMin < 5) out.push('Set the lesson duration (at least 5 minutes).');
  if (!(l.objectives ?? []).some((o) => o.trim())) out.push('Add at least one learning objective.');
  if (!hasText(l.presentation)) out.push('Write the lesson presentation.');
  return out;
}
export function wordCount(l: Record<string, unknown>): number {
  return RICH_SECTIONS.reduce((n, [k]) => n + (text(l[k]) ? text(l[k]).split(' ').length : 0), 0);
}

/** Local autosave: restore it only if it is newer than the saved copy and actually different. */
export interface LocalDraft { savedAt: number; data: Record<string, unknown> }
export function chooseDraft(local: LocalDraft | null, remoteUpdatedMs: number, remote: Record<string, unknown>): 'local' | 'remote' {
  if (!local || local.savedAt <= remoteUpdatedMs) return 'remote';
  return JSON.stringify(local.data) === JSON.stringify(remote) ? 'remote' : 'local';
}
/** Shallow comparison of the editable fields (used for the "unsaved changes" flag). */
export function isDirty(current: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  return JSON.stringify(current) !== JSON.stringify(saved);
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export interface LessonMeta { school: string; className: string; subjectName: string; teacherName: string; topic: string; week?: number }
/** Printable lesson note. `clean` must sanitise rich HTML (the app passes sanitizeHtml); all other fields are escaped here. */
export function lessonToHtml(l: LessonDoc & Record<string, unknown>, m: LessonMeta, clean: (html: string) => string, guide?: Record<string, unknown> | null): string {
  const rich = (k: string, label: string, src: Record<string, unknown>) => (hasText(src[k]) ? `<h3>${esc(label)}</h3><div>${clean(String(src[k]))}</div>` : '');
  const list = (a: string[] | undefined, label: string) => (a && a.some((x) => x.trim()) ? `<h3>${esc(label)}</h3><ul>${a.filter((x) => x.trim()).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  const supp = (l.supplementary ?? []).filter((s) => s.title || s.url).map((s) => `<li>${esc(s.title)} ${/^https?:\/\//i.test(s.url) ? `— ${esc(s.url)}` : ''}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(l.title)}</title><style>
body{font-family:Inter,Arial,sans-serif;color:#1a1a1a;margin:28px;line-height:1.5}h1{font-size:20px;color:#0B3D2E;margin:0}h2{font-size:15px;margin:2px 0 10px}h3{font-size:13px;color:#0B3D2E;margin:16px 0 4px;border-bottom:1px solid #C8A45A;padding-bottom:2px}
.meta{font-size:12px;margin:8px 0}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}img{max-width:100%}.guide{margin-top:24px;border:2px dashed #C8A45A;padding:8px 14px}@media print{@page{margin:14mm}}</style></head><body>
<h1>${esc(m.school)}</h1><h2>${esc(l.title)}</h2>
<div class="meta"><b>Class:</b> ${esc(m.className)} &nbsp; <b>Subject:</b> ${esc(m.subjectName)} &nbsp; <b>Topic:</b> ${esc(m.topic)} &nbsp; <b>Week:</b> ${esc(m.week ?? '')} &nbsp; <b>Duration:</b> ${esc(l.durationMin ?? '')} min &nbsp; <b>Teacher:</b> ${esc(m.teacherName)}</div>
${list(l.objectives, 'Learning objectives')}${list(l.materials, 'Instructional materials')}${RICH_SECTIONS.map(([k, label]) => rich(k, label, l)).join('')}${list(l.references, 'References')}${supp ? `<h3>Supplementary resources</h3><ul>${supp}</ul>` : ''}
${guide ? `<div class="guide"><h2>Teacher guide (not for learners)</h2>${GUIDE_SECTIONS.map(([k, label]) => rich(k, label, guide)).join('')}</div>` : ''}</body></html>`;
}
