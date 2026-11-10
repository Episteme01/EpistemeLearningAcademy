import { describe, expect, it } from 'vitest';
import { STUDENT_EMAIL_DOMAIN, isInternalEmail, kidPassword, loginEmail, makeUsername, usernameBase, usernameOfEmail } from '@/lib/studentLogin';

describe('student login', () => {
  it('a username becomes the hidden internal email; a real email is left alone', () => {
    expect(loginEmail(' Amina07 ')).toBe(`amina07@${STUDENT_EMAIL_DOMAIN}`);
    expect(loginEmail('Teacher@School.com')).toBe('teacher@school.com');
    expect(loginEmail('   ')).toBe('');
    expect(isInternalEmail(`amina07@${STUDENT_EMAIL_DOMAIN}`)).toBe(true);
    expect(isInternalEmail('a@gmail.com')).toBe(false);
    expect(usernameOfEmail(`amina07@${STUDENT_EMAIL_DOMAIN}`)).toBe('amina07');
  });
  it('usernames come from the first name and are unique', () => {
    expect(usernameBase('Ámina-Rose')).toBe('aminarose');
    expect(usernameBase('123')).toBe('student');
    expect(makeUsername('Amina', [], () => 0.07)).toBe('amina07');
    expect(makeUsername('Amina', ['amina07'], (() => { let n = 0; return () => [0.07, 0.08][n++ % 2]!; })())).toBe('amina08');
    const all = Array.from({ length: 100 }, (_, i) => `amina${String(i).padStart(2, '0')}`);
    expect(makeUsername('Amina', all, () => 0.5)).toMatch(/^amina\d{3}$/);
  });
  it('kid passwords are readable and long enough', () => {
    const p = kidPassword();
    expect(p).toHaveLength(8);
    expect(p).toMatch(/^[a-hj-km-np-z2-9]+$/);
  });
});
