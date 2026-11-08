import type { FieldDef } from '@/components/common/crudFields';
import { C } from '@/config/collections';

type R = Record<string, unknown> & { id: string };
const s = (v: unknown) => String(v ?? '');

export const classRef = (name = 'classId', labelField = 'className', required = true): FieldDef => ({
  name, label: 'Class', type: 'ref', required, ref: { collection: C.classes, label: (r: R) => s(r.name), labelField },
});
export const subjectRef = (name = 'subjectId', labelField = 'subjectName', required = true): FieldDef => ({
  name, label: 'Subject', type: 'ref', required, ref: { collection: C.subjects, label: (r: R) => `${s(r.name)}${r.code ? ` (${s(r.code)})` : ''}`, labelField },
});
export const staffRef = (name = 'staffId', label = 'Staff member'): FieldDef => ({
  name, label, type: 'ref', ref: { collection: C.staff, label: (r: R) => `${s(r.firstName)} ${s(r.lastName)}` },
});
export const sessionRef = (): FieldDef => ({ name: 'sessionId', label: 'Academic session', type: 'ref', required: true, ref: { collection: C.academicSessions, label: (r: R) => s(r.name), labelField: 'sessionName' } });
