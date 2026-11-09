// Pure rules for the file gateway. No Deno or browser APIs here, so it can be unit-tested in Node.
// KEEP IN SYNC with src/lib/filePolicy.ts (tests/files.test.ts fails if the two tables differ).

export type Purpose = 'site_image' | 'staff_image' | 'media_public' | 'avatar' | 'student_photo' | 'submission' | 'resource';
export type Kind = 'image' | 'audio' | 'document';
const MB = 1024 * 1024;

export interface PurposeRule {
  provider: 'cloudinary' | 'supabase';
  /** Supabase bucket, or Cloudinary folder */
  target: string;
  /** Roles allowed (any of). 'any' = every active signed-in user. */
  roles: string[] | 'any';
  /** Max bytes per kind; a kind that is missing is not allowed for this purpose. */
  limits: Partial<Record<Kind, number>>;
  /** extra context the caller must supply */
  needs?: 'studentId' | 'assignmentId';
}

const CMS = ['super_admin', 'admin', 'cms_editor', 'cms_author'];
const STAFF = ['super_admin', 'admin', 'principal', 'teacher'];

export const PURPOSES: Record<Purpose, PurposeRule> = {
  site_image:    { provider: 'cloudinary', target: 'ela/site',  roles: CMS, limits: { image: 10 * MB } },
  staff_image:     { provider: 'cloudinary', target: 'ela/staff',   roles: STAFF, limits: { image: 3 * MB } },
  media_public:  { provider: 'cloudinary', target: 'ela/media', roles: CMS, limits: { image: 10 * MB, audio: 10 * MB, document: 10 * MB } },
  avatar:        { provider: 'supabase',   target: 'avatars',   roles: 'any', limits: { image: 2 * MB } },
  student_photo: { provider: 'supabase',   target: 'avatars',   roles: ['super_admin', 'admin', 'principal', 'admissions'], limits: { image: 2 * MB }, needs: 'studentId' },
  submission:    { provider: 'supabase',   target: 'submissions', roles: ['student'], limits: { image: 10 * MB, document: 10 * MB }, needs: 'assignmentId' },
  resource:      { provider: 'supabase',   target: 'resources', roles: STAFF, limits: { image: 10 * MB, audio: 50 * MB, document: 25 * MB } },
};

const IMAGE = /^image\/(jpeg|png|webp|gif)$/;
const AUDIO = /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|wav|x-wav|ogg|webm)$/;
const DOC = /^(application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-(excel|powerpoint)))$/;
export const kindOfType = (t: string): Kind | null => (IMAGE.test(t) ? 'image' : AUDIO.test(t) ? 'audio' : DOC.test(t) ? 'document' : null);

export const hasRole = (rule: PurposeRule, roles: string[]) => rule.roles === 'any' || rule.roles.some((r) => roles.includes(r));

/** Returns an error message, or null when the upload is allowed. */
export function checkUpload(purpose: string, roles: string[], contentType: string, size: number, ctx: { studentId?: string; assignmentId?: string } = {}): string | null {
  const rule = (PURPOSES as Record<string, PurposeRule | undefined>)[purpose];
  if (!rule) return 'Unknown upload type.';
  if (!hasRole(rule, roles)) return 'Your role cannot upload this kind of file.';
  const kind = kindOfType(contentType);
  if (!kind) return 'This file type is not allowed.';
  const max = rule.limits[kind];
  if (!max) return `${kind[0]!.toUpperCase()}${kind.slice(1)} files are not allowed here.`;
  if (!Number.isFinite(size) || size <= 0) return 'The file is empty.';
  if (size > max) return `This ${kind} is too large (max ${Math.round(max / MB)} MB).`;
  if (rule.needs === 'studentId' && !/^[A-Za-z0-9_-]{6,64}$/.test(ctx.studentId ?? '')) return 'Missing student.';
  if (rule.needs === 'assignmentId' && !/^[A-Za-z0-9_-]{6,64}$/.test(ctx.assignmentId ?? '')) return 'Missing assignment.';
  return null;
}

export const safeName = (n: string) => n.normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.{2,}/g, '.').replace(/^\.+/, '').slice(-80) || 'file';

/** Object path inside the Supabase bucket. The first segment is always something the user cannot choose. */
export function buildPath(purpose: Purpose, uid: string, ctx: { studentId?: string; assignmentId?: string }, fileName: string, nowMs: number, rand: string): string {
  const stamp = `${nowMs.toString(36)}-${rand}`;
  const f = safeName(fileName);
  switch (purpose) {
    case 'avatar': return `users/${uid}/${stamp}-${f}`;
    case 'student_photo': return `students/${ctx.studentId}/${stamp}-${f}`;
    case 'submission': return `${uid}/${ctx.assignmentId}/${stamp}-${f}`;
    default: return `${uid}/${stamp}-${f}`;
  }
}

/** Which Firestore document (and field owner) authorises reading a private file, and the path prefix it must have. */
export const DOWNLOADS = {
  students:    { bucket: 'avatars',     field: 'photoRef', ownerPrefix: (docId: string) => `students/${docId}/` },
  users:       { bucket: 'avatars',     field: 'photoRef', ownerPrefix: (docId: string) => `users/${docId}/` },
  submissions: { bucket: 'submissions', field: 'fileRef',  ownerPrefix: (_d: string, f: Record<string, string>) => `${f.uid ?? '\0'}/` },
  resources:   { bucket: 'resources',   field: 'fileRef',  ownerPrefix: (_d: string, f: Record<string, string>) => `${f.createdBy ?? '\0'}/` },
} as const;
export type DownloadCollection = keyof typeof DOWNLOADS;

export function pathAllowed(collection: string, docId: string, path: string, docFields: Record<string, string>): boolean {
  const d = (DOWNLOADS as Record<string, (typeof DOWNLOADS)[DownloadCollection] | undefined>)[collection];
  if (!d || !path || path.includes('..') || path.startsWith('/')) return false;
  return path.startsWith(d.ownerPrefix(docId, docFields));
}

/** May this person delete this stored object? (owner by path prefix, or staff by role) */
export function canDeleteSupabase(bucket: string, path: string, uid: string, roles: string[]): boolean {
  if (!path || path.includes('..')) return false;
  const has = (r: string[]) => r.some((x) => roles.includes(x));
  if (bucket === 'avatars') return path.startsWith(`users/${uid}/`) || (path.startsWith('students/') && has(['super_admin', 'admin', 'principal', 'admissions']));
  if (bucket === 'submissions') return path.startsWith(`${uid}/`) || has(['super_admin', 'admin', 'principal', 'teacher']);
  if (bucket === 'resources') return path.startsWith(`${uid}/`) || has(['super_admin', 'admin', 'principal']);
  return false;
}
export function canDeleteCloudinary(publicId: string, roles: string[]): boolean {
  const has = (r: string[]) => r.some((x) => roles.includes(x));
  if (!publicId || publicId.includes('..')) return false;
  if (publicId.startsWith('ela/staff/')) return has(PURPOSES.staff_image.roles as string[]);
  if (publicId.startsWith('ela/site/') || publicId.startsWith('ela/media/')) return has(CMS);
  return false;
}
