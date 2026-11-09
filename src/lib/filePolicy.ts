// Client mirror of supabase/functions/files/policy.ts. The gateway is the real enforcement; this only gives
// instant feedback in the browser. tests/files.test.ts fails if the two tables drift apart.
export type Purpose = 'site_image' | 'staff_image' | 'media_public' | 'avatar' | 'student_photo' | 'submission' | 'resource';
export type Kind = 'image' | 'audio' | 'document';
const MB = 1024 * 1024;

export interface PurposeRule { provider: 'cloudinary' | 'supabase'; target: string; roles: string[] | 'any'; limits: Partial<Record<Kind, number>>; needs?: 'studentId' | 'assignmentId' }
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

/** Instant, friendly pre-check in the browser (the gateway repeats it authoritatively). */
export function precheck(purpose: Purpose, roles: string[], file: { type: string; size: number }): string | null {
  const rule = PURPOSES[purpose];
  if (rule.roles !== 'any' && !rule.roles.some((r) => roles.includes(r))) return 'Your role cannot upload this kind of file.';
  const kind = kindOfType(file.type);
  if (!kind) return 'This file type is not allowed. Use JPG/PNG/WebP/GIF images, MP3/M4A/WAV audio, PDF, Word, Excel, PowerPoint or text.';
  const max = rule.limits[kind];
  if (!max) return `${kind[0]!.toUpperCase()}${kind.slice(1)} files are not allowed here.`;
  if (file.size <= 0) return 'The file is empty.';
  if (file.size > max) return `This ${kind} is too large (max ${Math.round(max / MB)} MB).`;
  return null;
}
