import { collection, doc, where } from 'firebase/firestore';
import { C } from '@/config/collections';
import { db } from '@/config/firebase';
import { duplicatePlan, moveWithin, type CurriculumStatus, type SchemeRow, type Topic, canTransition } from '@/lib/curriculum';
import { audit } from './audit';
import { batchDelete, batchSet, createDoc, getById, listDocs, patchDoc, removeDoc } from './db';

const newId = (col: string) => doc(collection(db(), col)).id;
type Curr = { title: string; status: CurriculumStatus } & Record<string, unknown>;

export async function loadCurriculumParts(id: string) {
  const [topics, rows] = await Promise.all([
    listDocs<Omit<Topic, 'id'>>(C.curriculumTopics, [where('curriculumId', '==', id)]),
    listDocs<Omit<SchemeRow, 'id'>>(C.schemeOfWork, [where('curriculumId', '==', id)]),
  ]);
  return { topics: topics as unknown as Topic[], rows: rows as unknown as SchemeRow[] };
}

/** Copy a curriculum with all its topics and weekly plans. The copy is a draft. */
export async function duplicateCurriculum(id: string): Promise<string> {
  const src = await getById<Curr>(C.curricula, id);
  if (!src) throw new Error('That curriculum no longer exists.');
  const { topics, rows } = await loadCurriculumParts(id);
  const rest: Record<string, unknown> = { ...(src as Record<string, unknown>) };
  for (const k of ['id', 'createdAt', 'updatedAt']) delete rest[k];
  const plan = duplicatePlan(rest as Curr, topics, rows, () => newId(C.curriculumTopics));
  await createDoc(C.curricula, { ...plan.curriculum, version: 1, duplicatedFrom: id }, plan.curriculumId);
  const strip = <T extends { id: string }>(x: T) => { const d: Record<string, unknown> = { ...x }; delete d.id; return { id: x.id, data: d }; };
  await batchSet([
    ...plan.topics.map((t) => { const s = strip(t); return { col: C.curriculumTopics, id: s.id, data: s.data, merge: false }; }),
    ...plan.rows.map((r) => { const s = strip(r); return { col: C.schemeOfWork, id: s.id, data: s.data, merge: false }; }),
  ]);
  void audit('curriculum.duplicate', `curricula/${id}`, `copy ${plan.curriculumId}`);
  return plan.curriculumId;
}

export async function setCurriculumStatus(id: string, from: CurriculumStatus, to: CurriculumStatus) {
  if (!canTransition(from, to)) throw new Error(`A ${from} curriculum cannot become ${to}.`);
  await patchDoc(C.curricula, id, { status: to });
  void audit(`curriculum.${to}`, `curricula/${id}`, `${from} → ${to}`);
}

export async function saveTopic(curriculumId: string, id: string | null, data: Omit<Topic, 'id' | 'curriculumId'>) {
  if (id) { await patchDoc(C.curriculumTopics, id, data); return id; }
  return createDoc(C.curriculumTopics, { ...data, curriculumId });
}
export async function moveTopic(siblings: Topic[], id: string, dir: -1 | 1) {
  const ups = moveWithin(siblings, id, dir);
  if (ups.length) await batchSet(ups.map((u) => ({ col: C.curriculumTopics, id: u.id, data: { order: u.order } })));
}
/** Deleting a topic also removes its subtopics and every weekly-plan row that used them. */
export async function deleteTopic(topic: Topic, all: Topic[], rows: SchemeRow[]) {
  const ids = new Set([topic.id, ...all.filter((t) => t.parentId === topic.id).map((t) => t.id)]);
  await batchDelete([
    ...[...ids].map((i) => ({ col: C.curriculumTopics, id: i })),
    ...rows.filter((r) => ids.has(r.topicId) || ids.has(r.subtopicId)).map((r) => ({ col: C.schemeOfWork, id: r.id })),
  ]);
}
export async function saveSchemeRow(curriculumId: string, id: string | null, data: Omit<SchemeRow, 'id' | 'curriculumId'>) {
  if (id) { await patchDoc(C.schemeOfWork, id, data); return id; }
  return createDoc(C.schemeOfWork, { ...data, curriculumId });
}
export const deleteSchemeRow = (id: string) => removeDoc(C.schemeOfWork, id);

/** Removes the curriculum and everything under it. */
export async function deleteCurriculum(id: string) {
  const { topics, rows } = await loadCurriculumParts(id);
  await batchDelete([...rows.map((r) => ({ col: C.schemeOfWork, id: r.id })), ...topics.map((t) => ({ col: C.curriculumTopics, id: t.id }))]);
  await removeDoc(C.curricula, id);
  void audit('curriculum.delete', `curricula/${id}`, 'deleted with topics and schemes');
}
