import { describe, expect, it } from 'vitest';
import { PURPOSES as SERVER, buildPath, canDeleteCloudinary, canDeleteSupabase, checkUpload, pathAllowed, safeName } from '../supabase/functions/files/policy';
import { PURPOSES as CLIENT, precheck } from '@/lib/filePolicy';
import { providerOfUrl, publicUrl, refOf } from '@/lib/fileRef';

const MB = 1024 * 1024;
describe('policy tables', () => {
  it('client mirror equals the gateway table', () => { expect(CLIENT).toEqual(SERVER); });
});
describe('who may upload what', () => {
  it('students can submit work but not publish resources', () => {
    expect(checkUpload('submission', ['student'], 'application/pdf', MB, { assignmentId: 'abc12345' })).toBeNull();
    expect(checkUpload('resource', ['student'], 'application/pdf', MB)).toMatch(/role/);
  });
  it('teacher cannot upload site images; admin can', () => {
    expect(checkUpload('site_image', ['teacher'], 'image/png', MB)).toMatch(/role/);
    expect(checkUpload('site_image', ['admin'], 'image/png', MB)).toBeNull();
  });
  it('multi-role users are judged on the union', () => { expect(checkUpload('site_image', ['parent', 'cms_editor'], 'image/png', MB)).toBeNull(); });
  it('type and size limits', () => {
    expect(checkUpload('avatar', ['parent'], 'image/png', 3 * MB)).toMatch(/too large/);
    expect(checkUpload('avatar', ['parent'], 'application/pdf', MB)).toMatch(/not allowed/);
    expect(checkUpload('avatar', ['parent'], 'application/x-msdownload', MB)).toMatch(/not allowed/);
    expect(checkUpload('submission', ['student'], 'audio/mpeg', MB, { assignmentId: 'abc12345' })).toMatch(/not allowed here/);
    expect(checkUpload('resource', ['teacher'], 'audio/mpeg', 40 * MB)).toBeNull();
    expect(checkUpload('resource', ['teacher'], 'audio/mpeg', 60 * MB)).toMatch(/too large/);
    expect(checkUpload('resource', ['teacher'], 'application/pdf', 0)).toMatch(/empty/);
  });
  it('context is required and validated', () => {
    expect(checkUpload('submission', ['student'], 'application/pdf', MB, {})).toMatch(/assignment/);
    expect(checkUpload('student_photo', ['admin'], 'image/png', MB, { studentId: '../x' })).toMatch(/student/);
    expect(checkUpload('nope', ['admin'], 'image/png', MB)).toMatch(/Unknown/);
  });
  it('client precheck agrees', () => {
    expect(precheck('avatar', ['parent'], { type: 'image/png', size: 3 * MB })).toMatch(/too large/);
    expect(precheck('avatar', ['parent'], { type: 'image/png', size: MB })).toBeNull();
  });
});
describe('paths', () => {
  it('submission path starts with the uploader uid; names are sanitised', () => {
    const p = buildPath('submission', 'uidA', { assignmentId: 'asg12345' }, '../../My Work (1).pdf', 1700000000000, 'xyz');
    expect(p.startsWith('uidA/asg12345/')).toBe(true); expect(p.includes('..')).toBe(false); expect(p.includes(' ')).toBe(false);
    expect(safeName('....hidden').startsWith('.')).toBe(false);
  });
  it('avatar and student photo prefixes', () => {
    expect(buildPath('avatar', 'u1', {}, 'a.png', 1, 'r')).toMatch(/^users\/u1\//);
    expect(buildPath('student_photo', 'staff1', { studentId: 'stu12345' }, 'a.png', 1, 'r')).toMatch(/^students\/stu12345\//);
  });
});
describe('download authorisation', () => {
  it('path must match the record owner, never a path someone else chose', () => {
    expect(pathAllowed('submissions', 'a_u1', 'u1/a/file.pdf', { uid: 'u1' })).toBe(true);
    expect(pathAllowed('submissions', 'a_u1', 'u2/a/file.pdf', { uid: 'u1' })).toBe(false);
    expect(pathAllowed('submissions', 'a_u1', 'u1/../u2/x', { uid: 'u1' })).toBe(false);
    expect(pathAllowed('submissions', 'a_u1', 'x', {})).toBe(false);
    expect(pathAllowed('students', 's1', 'students/s1/p.png', {})).toBe(true);
    expect(pathAllowed('students', 's1', 'students/s2/p.png', {})).toBe(false);
    expect(pathAllowed('users', 'u1', 'users/u1/p.png', {})).toBe(true);
    expect(pathAllowed('resources', 'r1', 't1/x.pdf', { createdBy: 't1' })).toBe(true);
    expect(pathAllowed('payments', 'r1', 't1/x.pdf', {})).toBe(false);
  });
});
describe('deletion', () => {
  it('owners and the right staff only', () => {
    expect(canDeleteSupabase('submissions', 'u1/a/f.pdf', 'u1', ['student'])).toBe(true);
    expect(canDeleteSupabase('submissions', 'u1/a/f.pdf', 'u2', ['student'])).toBe(false);
    expect(canDeleteSupabase('submissions', 'u1/a/f.pdf', 'u2', ['teacher'])).toBe(true);
    expect(canDeleteSupabase('resources', 't1/f.pdf', 't2', ['teacher'])).toBe(false);
    expect(canDeleteSupabase('resources', 't1/f.pdf', 'p', ['principal'])).toBe(true);
    expect(canDeleteSupabase('avatars', 'students/s1/p.png', 'x', ['teacher'])).toBe(false);
    expect(canDeleteSupabase('nope', 'a', 'x', ['super_admin'])).toBe(false);
    expect(canDeleteCloudinary('ela/site/a', ['cms_editor'])).toBe(true);
    expect(canDeleteCloudinary('ela/site/a', ['teacher'])).toBe(false);
    expect(canDeleteCloudinary('other/a', ['super_admin'])).toBe(false);
  });
});
describe('legacy references', () => {
  it('detects providers and falls back to the old url', () => {
    expect(providerOfUrl('https://firebasestorage.googleapis.com/v0/b/x/o/a.png?alt=media')).toBe('firebase');
    expect(providerOfUrl('https://res.cloudinary.com/demo/image/upload/a.png')).toBe('cloudinary');
    expect(providerOfUrl('https://example.org/a.pdf')).toBe('link');
    expect(refOf(undefined, 'https://firebasestorage.googleapis.com/v0/b/x/o/a.png')?.provider).toBe('firebase');
    expect(refOf({ provider: 'supabase', bucket: 'resources', path: 't/a.pdf' }, 'https://old')?.provider).toBe('supabase');
    expect(publicUrl({ provider: 'supabase', path: 'a' })).toBeNull();
    expect(refOf(undefined, undefined)).toBeNull();
  });
});
