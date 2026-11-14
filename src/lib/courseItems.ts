import type { Lesson, LessonPlan } from '@/types/models';

/** What a module item can be. Quizzes and assignments sit inside the module, in order, next to the lessons. */
export type ItemType = Lesson['type'];
export const ITEM_LABEL: Record<ItemType, string> = {
  text: 'Text lesson', video: 'Video lesson', pdf: 'PDF resource', presentation: 'Presentation', file: 'Downloadable material',
  studio: 'Lesson Studio lesson', quiz: 'Quiz', assignment: 'Assignment',
};
/** These complete themselves when the learner submits; every other lesson uses "Mark complete" (or watched video). */
export const completesOnSubmit = (t: ItemType) => t === 'quiz' || t === 'assignment';

/** Problem with an item's required link, or null when it is ready to save. */
export function itemProblem(l: Pick<Lesson, 'type' | 'studioId' | 'quizId' | 'assignmentId'>): string | null {
  if (l.type === 'studio' && !l.studioId) return 'Choose the Lesson Studio lesson to attach.';
  if (l.type === 'quiz' && !l.quizId) return 'Choose the quiz for this item.';
  if (l.type === 'assignment' && !l.assignmentId) return 'Choose the assignment for this item.';
  return null;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = (h: unknown) => String(h ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const has = (h: unknown) => plain(h).length > 0 || /<img\b/i.test(String(h ?? ''));

/** Sections a learner may see. Teacher activities and the teacher guide (lessonGuides) are never copied into a course. */
const LEARNER_SECTIONS: Array<[keyof LessonPlan, string]> = [
  ['previousKnowledge', 'Before you start'], ['introduction', 'Introduction'], ['presentation', 'Lesson'], ['learnerActivities', 'Activities'],
  ['examples', 'Examples'], ['practical', 'Practical work'], ['assessmentQuestions', 'Check your understanding'], ['assignment', 'Assignment'], ['conclusion', 'Summary'],
];

/**
 * Learner-facing HTML of a Lesson Studio lesson. It is a COPY taken when the lesson is attached or re-synced, so a later draft
 * edit in the Studio never changes what learners see until the teacher syncs again. Rich sections stay HTML (the player sanitises
 * it on display); titles, lists and links are escaped here.
 */
export function studioToHtml(plan: Partial<LessonPlan>): string {
  const parts: string[] = [];
  const list = (a: string[] | undefined, label: string) => { const xs = (a ?? []).filter((x) => x.trim()); if (xs.length) parts.push(`<h3>${esc(label)}</h3><ul>${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`); };
  list(plan.objectives, 'What you will learn');
  list(plan.materials, 'What you need');
  for (const [k, label] of LEARNER_SECTIONS) { const v = plan[k]; if (has(v)) parts.push(`<h3>${esc(label)}</h3>${String(v)}`); }
  list(plan.references, 'References');
  const links = (plan.supplementary ?? []).filter((s) => s.title && /^https?:\/\//i.test(s.url));
  if (links.length) parts.push(`<h3>More to explore</h3><ul>${links.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></li>`).join('')}</ul>`);
  return parts.join('');
}
