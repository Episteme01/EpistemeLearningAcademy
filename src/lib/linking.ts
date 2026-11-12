/** Pure rules for linking login accounts to staff / student / parent records. */
export type LinkKind = 'staff' | 'student' | 'parent';
export interface UserLite { id: string; email?: string; displayName?: string; role?: string; roles?: string[]; status?: string; staffId?: string; studentId?: string; parentId?: string }
export interface RecordLite { id: string; userUid?: string; studentUid?: string }

export const USER_FIELD: Record<LinkKind, 'staffId' | 'studentId' | 'parentId'> = { staff: 'staffId', student: 'studentId', parent: 'parentId' };
export const RECORD_FIELD: Record<LinkKind, 'userUid' | 'studentUid'> = { staff: 'userUid', student: 'studentUid', parent: 'userUid' };
export const ROLE_FOR: Record<LinkKind, string> = { staff: 'teacher', student: 'student', parent: 'parent' };
const STAFF_ROLES = ['super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher', 'cms_editor', 'cms_author'];
export const rolesIn = (u: UserLite) => (u.roles && u.roles.length ? u.roles : u.role ? [u.role] : []);

/** Why this login cannot be linked to this record (null = fine). */
export function linkProblem(user: UserLite, record: RecordLite, kind: LinkKind, allRecords: RecordLite[]): string | null {
  if (record[RECORD_FIELD[kind]]) return 'This record already has a login. Unlink it first.';
  if (user[USER_FIELD[kind]]) return 'This login is already linked to another record of this type.';
  if (allRecords.some((r) => r.id !== record.id && r[RECORD_FIELD[kind]] === user.id)) return 'This login is already linked to another record of this type.';
  if (user.status === 'suspended') return 'This login is suspended. Re-activate it first.';
  if (kind === 'student' && rolesIn(user).includes('super_admin')) return 'A Super Administrator login cannot be used as a learner login.';
  return null;
}
/** Logins that can still be linked, filtered by a search text. */
export function candidatesFor(users: UserLite[], kind: LinkKind, allRecords: RecordLite[], search: string, showLinked = false): UserLite[] {
  const q = search.trim().toLowerCase();
  const taken = new Set(allRecords.map((r) => r[RECORD_FIELD[kind]]).filter(Boolean));
  return users
    .filter((u) => showLinked || (!u[USER_FIELD[kind]] && !taken.has(u.id)))
    .filter((u) => !q || `${u.displayName ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.displayName ?? '').localeCompare(b.displayName ?? ''));
}
/** The user-document changes when a login is linked. Existing roles are never removed. */
export function linkUserPatch(user: UserLite, kind: LinkKind, recordId: string): { roles: string[]; [k: string]: unknown } {
  const roles = [...rolesIn(user)];
  const need = kind === 'staff' ? (roles.some((r) => STAFF_ROLES.includes(r)) ? null : 'teacher') : ROLE_FOR[kind];
  if (need && !roles.includes(need)) roles.push(need);
  return { roles, [USER_FIELD[kind]]: recordId };
}
export interface UnlinkPlan { block?: string; warnings: string[]; userPatch: { roles?: string[]; status?: string; role?: string; [k: string]: unknown } }
/** What unlinking does, and whether it is allowed. The account itself is never deleted. */
export function unlinkPlan(user: UserLite, kind: LinkKind, opts: { isSelf: boolean; upcomingSessions: number }): UnlinkPlan {
  const warnings: string[] = []; const patch: UnlinkPlan['userPatch'] = { [USER_FIELD[kind]]: '' };
  if (opts.isSelf) return { block: 'You cannot unlink your own login.', warnings, userPatch: patch };
  if (rolesIn(user).includes('super_admin')) return { block: 'A Super Administrator login cannot be unlinked here.', warnings, userPatch: patch };
  if (kind === 'staff' && opts.upcomingSessions > 0) warnings.push(`${opts.upcomingSessions} upcoming scheduled class(es) are assigned to this login. Reassign them after unlinking.`);
  if (kind !== 'staff') {
    const left = rolesIn(user).filter((r) => r !== ROLE_FOR[kind]);
    patch.roles = left.length ? left : rolesIn(user);
    if (!left.length) { patch.status = 'suspended'; warnings.push('This login has no other role, so it will be suspended and can no longer sign in to anything.'); }
    else if (!left.includes(user.role ?? '')) patch.role = left[0];
  }
  return { warnings, userPatch: patch };
}
