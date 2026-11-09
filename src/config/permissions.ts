/**
 * Role model + client-side capability map.
 * IMPORTANT: this only controls what the UI shows. Real enforcement is done by
 * firebase/firestore.rules (and supabase/functions/files/policy.ts for file uploads) — keep them in sync.
 */
export type Role =
  | 'super_admin'
  | 'director'
  | 'principal'
  | 'admin'
  | 'admissions'
  | 'finance'
  | 'teacher'
  | 'cms_editor'
  | 'cms_author'
  | 'parent'
  | 'student';

export const ALL_ROLES: Role[] = [
  'super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher', 'cms_editor', 'cms_author', 'parent', 'student',
];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Administrator',
  director: 'Proprietor / Director',
  principal: 'Principal / Academic Head',
  admin: 'Administrator',
  admissions: 'Admissions Officer',
  finance: 'Finance Officer',
  teacher: 'Teacher',
  cms_editor: 'CMS Editor',
  cms_author: 'CMS Author',
  parent: 'Parent / Guardian',
  student: 'Student',
};

export type Platform = 'home' | 'cms' | 'ems' | 'lms' | 'cbt';

export const PLATFORM_LABELS: Record<Platform, string> = {
  home: 'Dashboard',
  cms: 'CMS',
  ems: 'EMS',
  lms: 'LMS',
  cbt: 'CBT',
};

export const PLATFORM_DESCRIPTIONS: Record<Platform, string> = {
  home: 'Your overview',
  cms: 'Content Management System',
  ems: 'Education Management System',
  lms: 'Learning Management System',
  cbt: 'Computer-Based Testing',
};

const STAFF_ROLES: Role[] = ['super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher', 'cms_editor', 'cms_author'];
export const isStaffRole = (r?: Role | null) => !!r && STAFF_ROLES.includes(r);

export type Permission =
  | 'cms.read' | 'cms.write' | 'cms.publish'
  | 'users.manage' | 'audit.read'
  | 'students.read' | 'students.write' | 'students.delete'
  | 'parents.write' | 'staff.write'
  | 'academics.write'
  | 'attendance.write'
  | 'finance.read' | 'finance.write'
  | 'results.write' | 'results.approve'
  | 'admissions.read'
  | 'analytics.read'
  | 'lms.manage' | 'cbt.manage'
  | 'settings.write';

const P = (...p: Permission[]) => p;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: P(
    'cms.read', 'cms.write', 'cms.publish', 'users.manage', 'audit.read', 'students.read', 'students.write', 'students.delete',
    'parents.write', 'staff.write', 'academics.write', 'attendance.write', 'finance.read', 'finance.write', 'results.write',
    'results.approve', 'admissions.read', 'analytics.read', 'lms.manage', 'cbt.manage', 'settings.write'),
  director: P('students.read', 'finance.read', 'admissions.read', 'analytics.read', 'audit.read'),
  principal: P(
    'students.read', 'students.write', 'parents.write', 'staff.write', 'academics.write', 'attendance.write', 'finance.read',
    'results.write', 'results.approve', 'admissions.read', 'analytics.read', 'lms.manage', 'cbt.manage'),
  admin: P(
    'cms.read', 'cms.write', 'cms.publish', 'users.manage', 'students.read', 'students.write', 'students.delete', 'parents.write',
    'staff.write', 'academics.write', 'attendance.write', 'finance.read', 'finance.write', 'results.write', 'results.approve',
    'admissions.read', 'analytics.read', 'lms.manage', 'cbt.manage', 'settings.write'),
  admissions: P('students.read', 'students.write', 'parents.write', 'admissions.read'),
  finance: P('students.read', 'finance.read', 'finance.write', 'analytics.read'),
  teacher: P('students.read', 'attendance.write', 'results.write', 'lms.manage', 'cbt.manage'),
  cms_editor: P('cms.read', 'cms.write', 'cms.publish'),
  cms_author: P('cms.read', 'cms.write'),
  parent: [],
  student: [],
};

export function can(role: Role | null | undefined, perm: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(perm);
}

/** Which platforms each role may enter (drives the platform switcher). */
export const ROLE_PLATFORMS: Record<Role, Platform[]> = {
  super_admin: ['home', 'cms', 'ems', 'lms', 'cbt'],
  director: ['home', 'ems', 'lms', 'cbt'],
  principal: ['home', 'ems', 'lms', 'cbt'],
  admin: ['home', 'cms', 'ems', 'lms', 'cbt'],
  admissions: ['home', 'ems'],
  finance: ['home', 'ems'],
  teacher: ['home', 'ems', 'lms', 'cbt'],
  cms_editor: ['home', 'cms'],
  cms_author: ['home', 'cms'],
  parent: ['home', 'ems', 'lms'],
  student: ['home', 'ems', 'lms', 'cbt'],
};


/** All roles a profile holds. Falls back to the legacy single `role` field. */
export function rolesOf(p?: { role?: Role; roles?: Role[] } | null): Role[] {
  if (!p) return [];
  const list = (p.roles?.length ? p.roles : p.role ? [p.role] : []).filter((r): r is Role => ALL_ROLES.includes(r));
  return [...new Set(list)];
}

/** Capability check across several roles (union). */
export function canAny(roles: Role[], perm: Permission): boolean {
  return roles.some((r) => can(r, perm));
}

/** Roles an actor may grant or remove. Only a super admin can touch super_admin/admin. */
export function assignableRoles(actorRoles: Role[]): Role[] {
  if (actorRoles.includes('super_admin')) return ALL_ROLES;
  if (actorRoles.includes('admin')) return ALL_ROLES.filter((r) => r !== 'super_admin' && r !== 'admin');
  return [];
}
