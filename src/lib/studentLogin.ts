/**
 * Student sign-in without an email address.
 * Firebase Auth needs an email, so a learner gets a hidden internal address built from a short username
 * (e.g. amina07 -> amina07@students.episteme.local). The learner only ever types the username.
 * Adult learners (isAdult) and every other role keep signing in with a real email.
 */
export const STUDENT_EMAIL_DOMAIN = 'students.episteme.local';

/** What the person typed -> the email Firebase should receive. Anything containing "@" is used as an email. */
export function loginEmail(identifier: string): string {
  const v = identifier.trim().toLowerCase();
  if (!v) return '';
  return v.includes('@') ? v : `${v.replace(/\s+/g, '')}@${STUDENT_EMAIL_DOMAIN}`;
}

export const isInternalEmail = (email?: string | null) => !!email && email.toLowerCase().endsWith(`@${STUDENT_EMAIL_DOMAIN}`);
export const usernameOfEmail = (email: string) => email.split('@')[0] ?? email;

/** First name -> lower-case letters only (accents removed). Falls back to "student". */
export function usernameBase(firstName: string): string {
  const b = firstName.normalize('NFKD').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12);
  return b || 'student';
}

/** First name + two digits (amina07). If every two-digit name is taken it moves to three digits. */
export function makeUsername(firstName: string, taken: Iterable<string>, rand: () => number = Math.random): string {
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  const base = usernameBase(firstName);
  for (const digits of [2, 3, 4]) {
    const max = 10 ** digits;
    for (let i = 0; i < 40; i++) {
      const name = `${base}${String(Math.floor(rand() * max)).padStart(digits, '0')}`;
      if (!used.has(name)) return name;
    }
  }
  return `${base}${Date.now().toString(36)}`;
}

/** Easy-to-read starter password for children (no 0/O, 1/l/I). Firebase needs at least 6 characters. */
export function kidPassword(length = 8, rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[Math.floor(rand() * chars.length)]!).join('');
}
