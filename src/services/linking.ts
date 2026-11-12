import { arrayRemove, arrayUnion, where } from 'firebase/firestore';
import { C } from '@/config/collections';
import { linkUserPatch, RECORD_FIELD, unlinkPlan, USER_FIELD, type LinkKind, type UnlinkPlan, type UserLite } from '@/lib/linking';
import { audit } from './audit';
import { listDocs, patchDoc } from './db';
import type { Session, Student, WithId } from '@/types/models';

const COLLECTION: Record<LinkKind, string> = { staff: C.staff, student: C.students, parent: C.parents };

/** Link an existing login to a record. Both sides are updated; other roles are left alone. */
export async function linkAccount(kind: LinkKind, recordId: string, user: UserLite, recordLabel: string) {
  await patchDoc(COLLECTION[kind], recordId, { [RECORD_FIELD[kind]]: user.id });
  await patchDoc(C.users, user.id, linkUserPatch(user, kind, recordId));
  if (kind === 'parent') {
    const kids = await listDocs<Student>(C.students, [where('parentIds', 'array-contains', recordId)]);
    for (const k of kids) await patchDoc(C.students, k.id, { parentUids: arrayUnion(user.id) });
  }
  void audit(`account.link_${kind}`, `users/${user.id}`, `${user.email} ↔ ${COLLECTION[kind]}/${recordId} (${recordLabel})`);
}

/** Works out what unlinking would do (so the screen can show it before the admin confirms). */
export async function planUnlink(kind: LinkKind, user: UserLite, isSelf: boolean): Promise<UnlinkPlan> {
  let upcoming = 0;
  if (kind === 'staff') {
    const rows = await listDocs<Session>(C.sessions, [where('teacherUid', '==', user.id)]).catch(() => [] as WithId<Session>[]);
    upcoming = rows.filter((r) => r.status === 'scheduled' && ((r.startAt as { toMillis?: () => number })?.toMillis?.() ?? 0) > Date.now()).length;
  }
  return unlinkPlan(user, kind, { isSelf, upcomingSessions: upcoming });
}
export async function unlinkAccount(kind: LinkKind, recordId: string, user: UserLite, plan: UnlinkPlan) {
  if (plan.block) throw new Error(plan.block);
  await patchDoc(COLLECTION[kind], recordId, { [RECORD_FIELD[kind]]: '' });
  await patchDoc(C.users, user.id, plan.userPatch);
  if (kind === 'parent') {
    const kids = await listDocs<Student>(C.students, [where('parentIds', 'array-contains', recordId)]);
    for (const k of kids) await patchDoc(C.students, k.id, { parentUids: arrayRemove(user.id) });
  }
  void audit(`account.unlink_${kind}`, `users/${user.id}`, `${user.email} ✕ ${COLLECTION[kind]}/${recordId}`);
}
export { USER_FIELD };
