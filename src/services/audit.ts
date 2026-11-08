import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { C } from '@/config/collections';

let actorRole = '';
/** Called by AuthContext so each audit record names the workspace (role) used. */
export function setAuditActorRole(r: string | null) { actorRole = r ?? ''; }

/** Append-only audit trail for sensitive actions. Failures never block the user action. */
export async function audit(action: string, target: string, detail = ''): Promise<void> {
  try {
    const u = auth().currentUser;
    if (!u) return;
    await addDoc(collection(db(), C.auditLogs), {
      action,
      target,
      detail: detail.slice(0, 500),
      actorUid: u.uid,
      actorRole,
      actorName: u.displayName ?? u.email ?? '',
      at: serverTimestamp(),
    });
  } catch (e) {
    console.warn('audit log failed', e);
  }
}
