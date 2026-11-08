import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, KeyRound, ArrowUpRight, UserPlus } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { Button } from '@/components/ui/button';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Field, Input, Select } from '@/components/ui/form';
import { Avatar, StatusBadge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { can, rolesOf, ROLE_LABELS, type Role } from '@/config/permissions';
import { createAccount, randomPassword } from '@/services/accounts';
import { nextStaffNo, nextStudentNo } from '@/services/counters';
import { addStudentHistory, attachParentUid, fullName, linkParent, promoteStudents } from '@/services/ems';
import { getById, patchDoc } from '@/services/db';
import { errorMessage, fmtDate } from '@/lib/utils';
import { audit } from '@/services/audit';
import type { ClassRoom, Parent, Staff, Student, UserProfile, WithId } from '@/types/models';
import { classRef } from './refs';
import { CLASS_LEVELS } from '@/features/public/content';

type SRow = WithId<Student> & Record<string, unknown>;
const byName = (a: { firstName?: string; lastName?: string }, b: { firstName?: string; lastName?: string }) => (a.lastName ?? '').localeCompare(b.lastName ?? '');

/** Dialog that creates a login and shows the one-time password. */
function AccountDialog({ open, onClose, defaults, roles, onCreated }: {
  open: boolean; onClose: () => void; defaults: { name: string; email: string; role: Role; studentId?: string; classId?: string; staffId?: string; parentId?: string };
  roles: Role[]; onCreated?: (uid: string) => Promise<void> | void;
}) {
  const toast = useToast();
  const [email, setEmail] = useState(defaults.email);
  const [role, setRole] = useState<Role>(defaults.role);
  const [pw] = useState(() => randomPassword());
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const uid = await createAccount({ email, password: pw, displayName: defaults.name, role, studentId: defaults.studentId, classId: defaults.classId, staffId: defaults.staffId, parentId: defaults.parentId, sendResetEmail: false });
      await onCreated?.(uid);
      setDone(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={() => { setDone(false); onClose(); }} title="Create portal login" description={defaults.name} size="sm"
      footer={done ? <Button onClick={() => { setDone(false); onClose(); }}>Done</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Create login</Button></>}>
      {done ? (
        <div className="space-y-2 text-sm"><p className="text-ok">Account created.</p><p>Share these credentials securely. The password is shown <strong>once</strong>; the user should change it via “Forgot password”.</p>
          <p className="rounded bg-cream p-3 font-mono text-[13px]">{email}<br />{pw}</p></div>
      ) : (
        <div className="space-y-4">
          <Field label="Email" required>{(a) => <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          {roles.length > 1 && <Field label="Role">{(a) => <Select {...a} value={role} onChange={(e) => setRole(e.target.value as Role)}>{roles.map((r) => <option key={r}>{r}</option>)}</Select>}</Field>}
          <p className="text-xs text-muted">A strong random password is generated for the first sign-in.</p>
        </div>
      )}
    </Dialog>
  );
}

/* ---------------------------------------------------------------- students */
export function StudentsPage() {
  const { role, profile } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const write = can(role, 'students.write');
  const parents = useCollection<Parent>(C.parents, () => [], 'all');
  const classes = useCollection<ClassRoom>(C.classes, () => [], 'all');
  const students = useCollection<Student>(C.students, () => [], 'all');
  const [linking, setLinking] = useState<SRow | null>(null);
  const [parentId, setParentId] = useState('');
  const [account, setAccount] = useState<SRow | null>(null);
  const [promote, setPromote] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const config: CrudConfig<SRow> = useMemo(() => ({
    collection: C.students, singular: 'Student', plural: 'Students', description: 'Registration, profiles, class allocation and records.', dialogSize: 'xl', auditActions: true,
    canCreate: write, canEdit: write, canDelete: can(role, 'students.delete'),
    fields: [
      { name: 'firstName', label: 'First name', type: 'text', required: true }, { name: 'lastName', label: 'Surname', type: 'text', required: true }, { name: 'otherNames', label: 'Other names', type: 'text' },
      { name: 'gender', label: 'Gender', type: 'select', required: true, options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] }, { name: 'dob', label: 'Date of birth', type: 'date' },
      classRef(), { name: 'programme', label: 'Programme', type: 'select', options: ['Academic', 'Islamic', 'Academic + Islamic', 'Coding / ICT', 'Skills'].map((v) => ({ value: v, label: v })) },
      { name: 'admissionStatus', label: 'Admission status', type: 'select', required: true, defaultValue: 'enrolled', options: ['applicant', 'admitted', 'enrolled', 'graduated', 'withdrawn'].map((v) => ({ value: v, label: v })) },
      { name: 'status', label: 'Student status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'suspended', 'inactive'].map((v) => ({ value: v, label: v })) },
      { name: 'guardianPhone', label: 'Guardian phone', type: 'tel' }, { name: 'address', label: 'Address', type: 'text', span: 2 },
      { name: 'stateOfOrigin', label: 'State of origin', type: 'text' }, { name: 'religion', label: 'Religion', type: 'text' }, { name: 'bloodGroup', label: 'Blood group', type: 'text' }, { name: 'allergies', label: 'Allergies / medical notes', type: 'textarea' },
      { name: 'photoUrl', label: 'Photograph', type: 'image' },
    ],
    columns: [
      { key: 'n', header: 'Student', primary: true, cell: (r) => <div className="flex items-center gap-3"><Avatar name={fullName(r)} src={r.photoUrl} /><div><p className="font-medium">{fullName(r)}</p><p className="text-xs text-muted">{r.studentNo}</p></div></div> },
      { key: 'c', header: 'Class', cell: (r) => r.className ?? '—' }, { key: 'a', header: 'Admission', cell: (r) => <StatusBadge status={r.admissionStatus} /> }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      { key: 'p', header: 'Parents', cell: (r) => (r.parentIds ?? []).length },
    ],
    searchKeys: ['firstName', 'lastName', 'studentNo', 'className'], sort: byName,
    filters: [{ name: 'classId', label: 'Class', options: classes.data.map((c) => ({ value: c.id, label: c.name })) }, { name: 'status', label: 'Status', options: ['active', 'suspended', 'inactive'].map((v) => ({ value: v, label: v })) }],
    exportColumns: [{ header: 'Student No', value: (r) => r.studentNo }, { header: 'Name', value: (r) => fullName(r) }, { header: 'Class', value: (r) => r.className }, { header: 'Status', value: (r) => r.status }],
    beforeSave: async (p, existing) => {
      if (existing) return p;
      return { ...p, studentNo: await nextStudentNo(), studentUid: '', parentUids: [], parentIds: [], admittedAt: new Date().toISOString().slice(0, 10) };
    },
    afterSave: async (id, p, existing) => {
      if (existing && (existing.classId !== p.classId || existing.status !== p.status)) {
        await addStudentHistory(id, `Updated: class ${existing.className ?? '—'} → ${String(p.className ?? '')}; status ${existing.status} → ${String(p.status)}`, profile?.displayName ?? '');
        if (existing.studentUid) await patchDoc(C.users, existing.studentUid, { classId: String(p.classId ?? '') }).catch(() => undefined);
      } else if (!existing) await addStudentHistory(id, 'Registered', profile?.displayName ?? '');
    },
    rowActions: (r) => (
      <>
        <Button size="icon" variant="ghost" aria-label="Open profile" onClick={() => nav(`/app/ems/students/${r.id}`)}><ArrowUpRight className="h-4 w-4" /></Button>
        {write && <Button size="icon" variant="ghost" aria-label="Link parent" onClick={() => { setLinking(r); setParentId(''); }}><Link2 className="h-4 w-4" /></Button>}
        {write && !r.studentUid && <Button size="icon" variant="ghost" aria-label="Create student login" onClick={() => setAccount(r)}><KeyRound className="h-4 w-4" /></Button>}
      </>
    ),
    headerActions: write ? <Button variant="outline" onClick={() => setPromote(true)}>Promote class</Button> : undefined,
  }), [write, role, classes.data, profile, nav]);

  const doLink = async () => {
    const p = parents.data.find((x) => x.id === parentId);
    if (!p || !linking) return;
    try { await linkParent(p, linking); toast.success(`Linked ${p.firstName} ${p.lastName} to ${fullName(linking)}`); setLinking(null); } catch (e) { toast.error(errorMessage(e)); }
  };
  const doPromote = async () => {
    const toClass = classes.data.find((c) => c.id === to);
    const list = students.data.filter((s) => s.classId === from && s.status === 'active');
    if (!toClass || !from || list.length === 0) return toast.error('Choose a source class with active students and a destination class.');
    try { await promoteStudents(list, toClass.id, toClass.name, profile?.displayName ?? ''); toast.success(`Promoted ${list.length} students to ${toClass.name}`); setPromote(false); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <>
      <CrudPage config={config} />
      <Dialog open={!!linking} onClose={() => setLinking(null)} title="Link parent / guardian" description={linking ? fullName(linking) : ''} size="sm"
        footer={<><Button variant="outline" onClick={() => setLinking(null)}>Cancel</Button><Button disabled={!parentId} onClick={() => void doLink()}>Link</Button></>}>
        <Field label="Parent / guardian">{(a) => <Select {...a} value={parentId} onChange={(e) => setParentId(e.target.value)}><option value="">Select…</option>{[...parents.data].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} — {p.phone}</option>)}</Select>}</Field>
        <p className="mt-2 text-xs text-muted">The parent must be registered first (EMS → Parents). One parent can be linked to many children.</p>
      </Dialog>
      {account && <AccountDialog open onClose={() => setAccount(null)} roles={['student']} defaults={{ name: fullName(account), email: '', role: 'student', studentId: account.id, classId: account.classId }}
        onCreated={async (uid) => { await patchDoc(C.students, account.id, { studentUid: uid }); }} />}
      <Dialog open={promote} onClose={() => setPromote(false)} title="Promote a class" description="Moves all active students from one class to another and records history." size="sm"
        footer={<><Button variant="outline" onClick={() => setPromote(false)}>Cancel</Button><Button onClick={() => void doPromote()}>Promote</Button></>}>
        <div className="space-y-4">
          <Field label="From class">{(a) => <Select {...a} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">Select…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
          <Field label="To class">{(a) => <Select {...a} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Select…</option>{classes.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}</Field>
        </div>
      </Dialog>
    </>
  );
}

/* ----------------------------------------------------------------- parents */
export function ParentsPage() {
  const { role } = useAuth();
  const write = can(role, 'parents.write');
  const toast = useToast();
  const { roles } = useAuth();
  const canLink = roles.includes('super_admin') || roles.includes('admin');
  const [account, setAccount] = useState<(WithId<Parent> & Record<string, unknown>) | null>(null);
  const [linkAcc, setLinkAcc] = useState<(WithId<Parent> & Record<string, unknown>) | null>(null);
  const [pick, setPick] = useState('');
  const users = useCollection<UserProfile>(C.users, () => (canLink ? [] : null), canLink ? 'all' : 'none');
  /** Attach an EXISTING login (e.g. a teacher who is also a parent) instead of creating a second account. */
  const linkExisting = async () => {
    const u = users.data.find((x) => x.id === pick);
    if (!linkAcc || !u) return;
    try {
      await attachParentUid(linkAcc, u.id);
      await patchDoc(C.users, u.id, { roles: [...new Set([...rolesOf(u), 'parent' as Role])], parentId: linkAcc.id });
      void audit('account.link_parent', `users/${u.id}`, `${u.email} ↔ parents/${linkAcc.id}; +parent role`);
      toast.success(`${u.displayName} now has a Parent workspace for ${linkAcc.firstName}'s children.`);
      setLinkAcc(null); setPick('');
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const config: CrudConfig<WithId<Parent> & Record<string, unknown>> = {
    collection: C.parents, singular: 'Parent', plural: 'Parents / guardians', description: 'One parent can be linked to many children.', auditActions: true, canCreate: write, canEdit: write, canDelete: false,
    fields: [
      { name: 'firstName', label: 'First name', type: 'text', required: true }, { name: 'lastName', label: 'Surname', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone / WhatsApp', type: 'tel', required: true },
      { name: 'relationship', label: 'Relationship', type: 'select', options: ['Mother', 'Father', 'Guardian', 'Other'].map((v) => ({ value: v, label: v })) }, { name: 'occupation', label: 'Occupation', type: 'text' }, { name: 'address', label: 'Address', type: 'text', span: 2 },
    ],
    columns: [
      { key: 'n', header: 'Parent', primary: true, cell: (r) => <div><p className="font-medium">{r.firstName} {r.lastName}</p><p className="text-xs text-muted">{r.email}</p></div> }, { key: 'p', header: 'Phone', cell: (r) => r.phone },
      { key: 'c', header: 'Children', cell: (r) => (r.studentIds ?? []).length }, { key: 'l', header: 'Portal login', cell: (r) => <StatusBadge status={r.userUid ? 'active' : 'pending'} /> },
    ],
    searchKeys: ['firstName', 'lastName', 'email', 'phone'], sort: byName,
    beforeSave: (p, e) => (e ? p : { ...p, studentIds: [], userUid: '' }),
    rowActions: (r) => (write && !r.userUid ? <><Button size="icon" variant="ghost" aria-label="Create parent login" onClick={() => setAccount(r)}><KeyRound className="h-4 w-4" /></Button>{canLink && <Button size="icon" variant="ghost" aria-label="Link an existing login" onClick={() => { setLinkAcc(r); setPick(''); }}><UserPlus className="h-4 w-4" /></Button>}</> : null),
  };
  return (
    <>
      <CrudPage config={config} />
      <Dialog open={!!linkAcc} onClose={() => setLinkAcc(null)} title="Link an existing login" description="For someone who already has an account (e.g. a teacher who is also a parent). No second account is created." size="sm" footer={<><Button variant="outline" onClick={() => setLinkAcc(null)}>Cancel</Button><Button disabled={!pick} onClick={() => void linkExisting()}>Link and add Parent role</Button></>}>
        <Field label="Person">{(a) => <Select {...a} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select…</option>{users.data.filter((u) => u.status === 'active').map((u) => <option key={u.id} value={u.id}>{u.displayName} — {rolesOf(u).map((r) => ROLE_LABELS[r]).join(', ')}</option>)}</Select>}</Field>
      </Dialog>
      {account && <AccountDialog open onClose={() => setAccount(null)} roles={['parent']} defaults={{ name: `${account.firstName} ${account.lastName}`, email: account.email, role: 'parent', parentId: account.id }} onCreated={(uid) => attachParentUid(account, uid)} />}
    </>
  );
}

/* ------------------------------------------------------------------- staff */
export function StaffPage() {
  const { role } = useAuth();
  const write = can(role, 'staff.write');
  const depts = useCollection<{ name: string }>(C.departments, () => [], 'all');
  const [account, setAccount] = useState<(WithId<Staff> & Record<string, unknown>) | null>(null);
  const config: CrudConfig<WithId<Staff> & Record<string, unknown>> = {
    collection: C.staff, singular: 'Staff member', plural: 'Staff', description: 'Staff records, departments and statuses.', auditActions: true, canCreate: write, canEdit: write, canDelete: false,
    fields: [
      { name: 'firstName', label: 'First name', type: 'text', required: true }, { name: 'lastName', label: 'Surname', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'department', label: 'Department', type: 'select', options: depts.data.map((d) => ({ value: d.name, label: d.name })) }, { name: 'position', label: 'Position', type: 'text' },
      { name: 'dateJoined', label: 'Date joined', type: 'date' }, { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'on_leave', 'resigned', 'inactive'].map((v) => ({ value: v, label: v.replace('_', ' ') })) },
    ],
    columns: [
      { key: 'n', header: 'Staff', primary: true, cell: (r) => <div><p className="font-medium">{r.firstName} {r.lastName}</p><p className="text-xs text-muted">{r.staffNo}</p></div> }, { key: 'd', header: 'Department', cell: (r) => r.department ?? '—' },
      { key: 'p', header: 'Position', cell: (r) => r.position ?? '—' }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }, { key: 'l', header: 'Login', cell: (r) => <StatusBadge status={r.userUid ? 'active' : 'pending'} /> },
    ],
    searchKeys: ['firstName', 'lastName', 'staffNo', 'department', 'position'], sort: byName, filters: [{ name: 'status', label: 'Status', options: ['active', 'on_leave', 'resigned', 'inactive'].map((v) => ({ value: v, label: v })) }],
    beforeSave: async (p, e) => (e ? p : { ...p, staffNo: await nextStaffNo(), userUid: '' }),
    rowActions: (r) => (write && can(role, 'users.manage') && !r.userUid ? <Button size="icon" variant="ghost" aria-label="Create staff login" onClick={() => setAccount(r)}><KeyRound className="h-4 w-4" /></Button> : null),
  };
  return (
    <>
      <CrudPage config={config} />
      {account && <AccountDialog open onClose={() => setAccount(null)} roles={['teacher', 'principal', 'admissions', 'finance', 'cms_editor', 'cms_author', 'director']} defaults={{ name: `${account.firstName} ${account.lastName}`, email: account.email, role: 'teacher', staffId: account.id }} onCreated={(uid) => patchDoc(C.staff, account.id, { userUid: uid })} />}
    </>
  );
}

/* ------------------------------------------------- academic structure CRUDs */
type Row = Record<string, unknown> & { id: string };
export const ClassesPage = () => {
  const { role } = useAuth(); const w = can(role, 'academics.write');
  return <CrudPage config={{
    collection: C.classes, singular: 'Class', plural: 'Classes', description: 'Classes and levels with class teachers.', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [
      { name: 'name', label: 'Class name', type: 'text', required: true, placeholder: 'JSS 1' }, { name: 'level', label: 'Level', type: 'select', required: true, options: CLASS_LEVELS.map((v) => ({ value: v, label: v })) },
      { name: 'arm', label: 'Arm / section', type: 'text' }, { name: 'capacity', label: 'Capacity', type: 'number', min: 1 },
      { name: 'classTeacherId', label: 'Class teacher', type: 'ref', ref: { collection: C.staff, label: (r) => `${String(r.firstName)} ${String(r.lastName)}${r.userUid ? '' : ' (no login)'}` }, hint: 'The teacher needs a portal login to mark attendance.' },
    ],
    beforeSave: async (p) => {
      if (!p.classTeacherId) return { ...p, classTeacherUid: '', classTeacherName: '' };
      const t = await getById<Staff>(C.staff, String(p.classTeacherId));
      return { ...p, classTeacherUid: t?.userUid ?? '', classTeacherName: t ? `${t.firstName} ${t.lastName}` : '' };
    },
    columns: [{ key: 'n', header: 'Class', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'l', header: 'Level', cell: (r: Row & { level?: string }) => r.level }, { key: 't', header: 'Class teacher', cell: (r: Row & { classTeacherName?: string }) => r.classTeacherName || '—' }, { key: 'c', header: 'Capacity', cell: (r: Row & { capacity?: number }) => r.capacity ?? '—' }],
    searchKeys: ['name', 'level'],
  } as CrudConfig<Row>} />;
};
export const SubjectsPage = () => {
  const { role } = useAuth(); const w = can(role, 'academics.write');
  return <CrudPage config={{
    collection: C.subjects, singular: 'Subject', plural: 'Subjects', description: 'Conventional, Islamic, ICT and skills subjects.', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [{ name: 'name', label: 'Subject name', type: 'text', required: true }, { name: 'code', label: 'Code', type: 'text', required: true }, { name: 'category', label: 'Category', type: 'select', required: true, defaultValue: 'conventional', options: ['conventional', 'islamic', 'ict', 'skills'].map((v) => ({ value: v, label: v })) },
      { name: 'departmentId', label: 'Department', type: 'ref', ref: { collection: C.departments, label: (r) => String(r.name) } }],
    columns: [{ key: 'n', header: 'Subject', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'c', header: 'Code', cell: (r: Row & { code?: string }) => r.code }, { key: 'k', header: 'Category', cell: (r: Row & { category?: string }) => r.category }],
    searchKeys: ['name', 'code'], filters: [{ name: 'category', label: 'Category', options: ['conventional', 'islamic', 'ict', 'skills'].map((v) => ({ value: v, label: v })) }],
  } as CrudConfig<Row>} />;
};
export const DepartmentsPage = () => (
  <CrudPage config={{
    collection: C.departments, singular: 'Department', plural: 'Departments', auditActions: true,
    fields: [{ name: 'name', label: 'Department', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'textarea' }],
    columns: [{ key: 'n', header: 'Department', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'd', header: 'Description', cell: (r: Row & { description?: string }) => r.description ?? '' }], searchKeys: ['name'],
  } as CrudConfig<Row>} />
);

export const TeacherAssignmentsPage = () => {
  const { role } = useAuth(); const w = can(role, 'academics.write');
  return <CrudPage config={{
    collection: C.teacherAssignments, singular: 'Assignment', plural: 'Teacher assignments', description: 'Which teacher teaches which subject in which class. Teachers can only enter results for their assignments (enforced by security rules).',
    canCreate: w, canEdit: false, canDelete: w, auditActions: true,
    fields: [{ name: 'staffId', label: 'Teacher', type: 'ref', required: true, ref: { collection: C.staff, label: (r) => `${String(r.firstName)} ${String(r.lastName)}${r.userUid ? '' : ' (no login)'}` } }, classRef(), { name: 'subjectId', label: 'Subject', type: 'ref', required: true, ref: { collection: C.subjects, label: (r) => String(r.name), labelField: 'subjectName' } }],
    beforeSave: async (p) => {
      const t = await getById<Staff>(C.staff, String(p.staffId));
      if (!t?.userUid) throw new Error('This staff member has no portal login yet. Create one under EMS → Staff first.');
      return { ...p, staffUid: t.userUid, staffName: `${t.firstName} ${t.lastName}` };
    },
    idFor: (p) => `${String(p.staffUid)}_${String(p.classId)}_${String(p.subjectId)}`,
    columns: [{ key: 't', header: 'Teacher', primary: true, cell: (r: Row & { staffName?: string }) => <span className="font-medium">{r.staffName}</span> }, { key: 'c', header: 'Class', cell: (r: Row & { className?: string }) => r.className }, { key: 's', header: 'Subject', cell: (r: Row & { subjectName?: string }) => r.subjectName }],
    searchKeys: ['staffName', 'className', 'subjectName'],
  } as CrudConfig<Row>} />;
};

export function AcademicPage() {
  const { role } = useAuth(); const w = can(role, 'academics.write');
  const [tab, setTab] = useState<'sessions' | 'terms' | 'calendar'>('sessions');
  const sessionCfg = {
    collection: C.academicSessions, singular: 'Session', plural: 'Academic sessions', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [{ name: 'name', label: 'Session', type: 'text', required: true, placeholder: '2025/2026' }, { name: 'startDate', label: 'Starts', type: 'date', required: true }, { name: 'endDate', label: 'Ends', type: 'date', required: true }, { name: 'current', label: 'Current session', type: 'checkbox' }],
    columns: [{ key: 'n', header: 'Session', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'a', header: 'Dates', cell: (r: Row & { startDate?: string; endDate?: string }) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` }, { key: 'c', header: 'Current', cell: (r: Row & { current?: boolean }) => (r.current ? <StatusBadge status="active" /> : '—') }],
    searchKeys: ['name'], sort: (a: Row, b: Row) => String(b.name).localeCompare(String(a.name)),
  } as CrudConfig<Row>;
  const termCfg = {
    collection: C.terms, singular: 'Term', plural: 'Terms', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [{ name: 'sessionId', label: 'Session', type: 'ref', required: true, ref: { collection: C.academicSessions, label: (r: Row) => String(r.name), labelField: 'sessionName' } }, { name: 'name', label: 'Term', type: 'select', required: true, options: ['First Term', 'Second Term', 'Third Term'].map((v) => ({ value: v, label: v })) },
      { name: 'startDate', label: 'Starts', type: 'date', required: true }, { name: 'endDate', label: 'Ends', type: 'date', required: true }, { name: 'current', label: 'Current term', type: 'checkbox' }],
    columns: [{ key: 'n', header: 'Term', primary: true, cell: (r: Row & { name: string; sessionName?: string }) => <span className="font-medium">{r.sessionName} — {r.name}</span> }, { key: 'a', header: 'Dates', cell: (r: Row & { startDate?: string; endDate?: string }) => `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` }, { key: 'c', header: 'Current', cell: (r: Row & { current?: boolean }) => (r.current ? <StatusBadge status="active" /> : '—') }],
    searchKeys: ['name', 'sessionName'],
  } as CrudConfig<Row>;
  const calCfg = {
    collection: C.calendarEvents, singular: 'Event', plural: 'Academic calendar', auditActions: true, canCreate: w, canEdit: w, canDelete: w,
    fields: [{ name: 'title', label: 'Event', type: 'text', required: true }, { name: 'start', label: 'Starts', type: 'date', required: true }, { name: 'end', label: 'Ends', type: 'date' }, { name: 'type', label: 'Type', type: 'select', options: ['term', 'holiday', 'exam', 'event'].map((v) => ({ value: v, label: v })) }],
    columns: [{ key: 't', header: 'Event', primary: true, cell: (r: Row & { title: string }) => <span className="font-medium">{r.title}</span> }, { key: 's', header: 'Date', cell: (r: Row & { start?: string; end?: string }) => `${fmtDate(r.start)}${r.end ? ` – ${fmtDate(r.end)}` : ''}` }, { key: 'y', header: 'Type', cell: (r: Row & { type?: string }) => r.type }],
    searchKeys: ['title'], sort: (a: Row, b: Row) => String(a.start).localeCompare(String(b.start)),
  } as CrudConfig<Row>;
  return (
    <>
      <div className="mb-4 flex gap-2">{(['sessions', 'terms', 'calendar'] as const).map((t) => <Button key={t} size="sm" variant={tab === t ? 'primary' : 'outline'} onClick={() => setTab(t)}>{t === 'calendar' ? 'Calendar' : t === 'sessions' ? 'Sessions' : 'Terms'}</Button>)}</div>
      {tab === 'sessions' ? <CrudPage key="s" config={sessionCfg} /> : tab === 'terms' ? <CrudPage key="t" config={termCfg} /> : <CrudPage key="c" config={calCfg} />}
    </>
  );
}

