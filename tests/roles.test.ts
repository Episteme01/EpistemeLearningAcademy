import { describe, expect, it } from 'vitest';
import { assignableRoles, canAny, rolesOf, ALL_ROLES } from '@/config/permissions';

describe('multi-role identity', () => {
  it('falls back to the legacy single role', () => {
    expect(rolesOf({ role: 'teacher' })).toEqual(['teacher']);
  });
  it('de-duplicates and drops unknown roles', () => {
    expect(rolesOf({ role: 'teacher', roles: ['teacher', 'parent', 'parent', 'wizard' as never] })).toEqual(['teacher', 'parent']);
  });
  it('returns nothing for a missing profile', () => {
    expect(rolesOf(null)).toEqual([]);
  });
  it('unions capabilities across roles', () => {
    expect(canAny(['parent', 'teacher'], 'attendance.write')).toBe(true);
    expect(canAny(['parent', 'student'], 'attendance.write')).toBe(false);
  });
  it('only a super admin may assign admin tiers', () => {
    expect(assignableRoles(['super_admin'])).toEqual(ALL_ROLES);
    const a = assignableRoles(['admin']);
    expect(a.includes('super_admin')).toBe(false); expect(a.includes('admin')).toBe(false); expect(a.includes('teacher')).toBe(true);
    expect(assignableRoles(['teacher', 'parent'])).toEqual([]);
  });
});
