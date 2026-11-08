import { writeBatch, doc, collection, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';

export interface NotificationInput {
  title: string;
  body?: string;
  link?: string;
}

/**
 * In-app notifications (stored per user, delivered in real time through Firestore).
 * Email/SMS delivery is intentionally out of scope for the free tier — see
 * docs/ARCHITECTURE.md for the optional "Trigger Email" extension / Functions hook.
 */
export async function notifyUsers(userUids: string[], n: NotificationInput): Promise<void> {
  const uniq = [...new Set(userUids.filter(Boolean))];
  if (!uniq.length) return;
  try {
    const b = writeBatch(db());
    for (const uid of uniq.slice(0, 400)) {
      b.set(doc(collection(db(), C.notifications)), { userUid: uid, ...n, read: false, createdAt: serverTimestamp() });
    }
    await b.commit();
  } catch (e) {
    console.warn('notify failed', e);
  }
}

export async function markRead(id: string): Promise<void> {
  await updateDoc(doc(db(), C.notifications, id), { read: true });
}
