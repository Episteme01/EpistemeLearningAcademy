import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query, serverTimestamp, addDoc,
  writeBatch, type QueryConstraint, type Unsubscribe, type DocumentData,
} from 'firebase/firestore';
import { db } from '@/config/firebase';
import type { WithId } from '@/types/models';
import { chunk } from '@/lib/utils';

/** Remove `undefined` (rejected by Firestore) from plain objects/arrays, leaving Timestamps/FieldValues intact. */
export function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => clean(v)) as unknown as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = clean(v);
    }
    return out as T;
  }
  return value;
}

const withId = <T>(d: { id: string; data: () => DocumentData }): WithId<T> => ({ ...(d.data() as T), id: d.id });

export function subscribeCollection<T>(
  name: string,
  constraints: QueryConstraint[],
  onData: (rows: WithId<T>[]) => void,
  onError?: (e: Error) => void,
): Unsubscribe {
  const q = query(collection(db(), name), ...constraints);
  return onSnapshot(q, (snap) => onData(snap.docs.map((d) => withId<T>(d))), (e) => onError?.(e));
}

export function subscribeDoc<T>(name: string, id: string, onData: (row: WithId<T> | null) => void, onError?: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(db(), name, id), (d) => onData(d.exists() ? withId<T>(d) : null), (e) => onError?.(e));
}

export async function listDocs<T>(name: string, constraints: QueryConstraint[] = []): Promise<WithId<T>[]> {
  const snap = await getDocs(query(collection(db(), name), ...constraints));
  return snap.docs.map((d) => withId<T>(d));
}

export async function getById<T>(name: string, id: string): Promise<WithId<T> | null> {
  const d = await getDoc(doc(db(), name, id));
  return d.exists() ? withId<T>(d) : null;
}

export async function createDoc<T extends object>(name: string, data: T, id?: string): Promise<string> {
  const payload = { ...clean(data), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  if (id) {
    await setDoc(doc(db(), name, id), payload);
    return id;
  }
  const ref = await addDoc(collection(db(), name), payload);
  return ref.id;
}

export async function patchDoc(name: string, id: string, data: object): Promise<void> {
  await updateDoc(doc(db(), name, id), { ...clean(data), updatedAt: serverTimestamp() });
}

export async function replaceDoc(name: string, id: string, data: object): Promise<void> {
  await setDoc(doc(db(), name, id), { ...clean(data), updatedAt: serverTimestamp() }, { merge: true });
}

export async function removeDoc(name: string, id: string): Promise<void> {
  await deleteDoc(doc(db(), name, id));
}

/** Write many documents in batches of 400 (Firestore limit is 500 operations). */
export async function batchSet(ops: { col: string; id: string; data: object; merge?: boolean }[]): Promise<void> {
  for (const part of chunk(ops, 400)) {
    const b = writeBatch(db());
    for (const op of part) {
      b.set(doc(db(), op.col, op.id), { ...clean(op.data), updatedAt: serverTimestamp() }, { merge: op.merge ?? true });
    }
    await b.commit();
  }
}

export async function batchDelete(ops: { col: string; id: string }[]): Promise<void> {
  for (const part of chunk(ops, 400)) {
    const b = writeBatch(db());
    for (const op of part) b.delete(doc(db(), op.col, op.id));
    await b.commit();
  }
}

export async function deleteLessonProgress(id: string): Promise<void> {
  await deleteDoc(doc(db(), 'lessonProgress', id));
}
