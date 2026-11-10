import { SecureAvatar } from '@/components/common/SecureAvatar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2, KeyRound, ArrowUpRight, UserPlus, Users, X, LockKeyhole, Printer } from 'lucide-react';
import { where } from 'firebase/firestore';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { Button } from '@/components/ui/button';
import { Dialog, useToast } from '@/components/ui/overlay';
import { Field, Input, Select } from '@/components/ui/form';
import { StatusBadge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { can, rolesOf, ROLE_LABELS, type Role } from '@/config/permissions';
import { createAccount, randomPassword } from '@/services/accounts';
import { nextStaffNo } from '@/services/counters';
import { addStudentHistory, attachParentUid, fullName, linkParent, linkTeacher, promoteStudents, unlinkParent, unlinkTeacher } from '@/services/ems';
import { kidPassword, makeUsername, STUDENT_EMAIL_DOMAIN } from '@/lib/studentLogin';
import { getById, listDocs, patchDoc } from '@/services/db';
import { resetStudentPassword } from '@/services/studentAdmin';
import { AdmissionLetterDialog, canPrintAdmissionLetter } from './AdmissionLetter';
import { errorMessage, fmtDate } from '@/lib/utils';
import { audit } from '@/services/audit';
import type { ClassRoom, Parent, Staff, Student, UserProfile, WithId } from '@/types/models';
import { classRef } from './refs';
import { CLASS_LEVELS } from '@/features/public/content';

type SRow = WithId<Student> & Record<string, unknown>;
const byName = (a: { firstName?: string; lastName?: string }, b: { firstName?: string; lastName?: string }) => (a.lastName ?? '').localeCompare(b.lastName ?? '');

/**
 * Dialog that creates a login and shows the one-time password.
 * Children (role student, not adult) get a username instead of an email; everyone else uses a real email.
 */
function AccountDialog({ open, onClose, defaults, roles, onCreated, takenUsernames = [] }: {
  open: boolean; onClose: () => void;
  defaults: { name: string; email: string; role: Role; studentId?: string; classId?: string; staffId?: string; parentId?: string; firstName?: string; isAdult?: boolean };
  roles: Role[]; onCreated?: (uid: string, username?: string) => Promise<void> | void; takenUsernames?: string[];
}) {
  const toast = useToast();
  const kid = defaults.role === 'student' && !defaults.isAdult;
  const [email, setEmail] = useState(defaults.email);
  const [role, setRole] = useState<Role>(defaults.role);
  const [username, setUsername] = useState(() => (kid ? makeUsername(defaults.firstName || defaults.name, takenUsernames) : ''));
  const [pw, setPw] = useState(() => (kid ? kidPassword() : randomPassword()));
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (kid && pw.length < 6) return toast.error('The password needs at least 6 characters.');
    if (!kid && !email.trim()) return toast.error('An email is required for this login.');
    setBusy(true);
    try {
      const base = { password: pw, displayName: defaults.name, role, studentId: defaults.studentId, classId: defaults.classId, staffId: defaults.staffId, parentId: defaults.parentId, sendResetEmail: false };
      if (!kid) {
        const uid = await createAccount({ ...base, email });
        await onCreated?.(uid);
      } else {
        // A username clash shows up as "email already in use"; try a fresh number a few times.
        let name = username; const tried = [...takenUsernames];
        for (let attempt = 0; ; attempt++) {
          try {
            const uid = await createAccount({ ...base, email: `${name}@${STUDENT_EMAIL_DOMAIN}`, username: name });
            setUsername(name); await onCreated?.(uid, name); break;
          } catch (e) {
            if (attempt < 4 && /email-already-in-use/.test(String((e as { code?: string })?.code ?? e))) { tried.push(name); name = makeUsername(defaults.firstName || defaults.name, tried); continue; }
            throw e;
          }
        }
      }
      setDone(true);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onClose={() => { setDone(false); onClose(); }} title="Create portal login" description={defaults.name} size="sm"
      footer={done ? <Button onClick={() => { setDone(false); onClose(); }}>Done</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Create login</Button></>}>
      {done ? (
        <div className="space-y-2 text-sm"><p className="text-ok">Account created.</p>
          <p>{kid ? 'Give the child these details. They sign in with the username and password (no email needed).' : <>Share these credentials securely. The password is shown <strong>once</strong>; the user should change it via “Forgot password”.</>}</p>
          <p className="rounded bg-cream p-3 font-mono text-[13px]">{kid ? <>Username: {username}</> : email}<br />Password: {pw}</p></div>
      ) : kid ? (
        <div className="space-y-4">
          <Field label="Username" hint="Made from the first name. The child types this to sign in.">{(a) => <Input {...a} value={username} readOnly />}</Field>
          <Field label="Starting password" hint="You can change it. At least 6 characters.">{(a) => <Input {...a} value={pw} onChange={(e) => setPw(e.target.value.replace(/\s/g, ''))} />}</Field>
          <p className="text-xs text-muted">No email is needed. For an adult learner, tick “Adult learner” on the student record first, and they will sign in with their own email.</p>
        </div>
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

/** Who a learner is linked to (parents and teachers). Used from Students and from Users & access. */
export function LinkedPeopleDialog({ studentId, onClose }: { studentId: string | null; onClose: () => void }) {
  const toast = useToast();
  const parents = useCollection<Parent>(C.parents, () => [], 'all');
  const staff = useCollection<Staff>(C.staff, () => [], 'all');
  const [student, setStudent] = useState<WithId<Student> | null>(null);
  const [parentPick, setParentPick] = useState(''); const [teacherPick, setTeacherPick] = useState('');
  const load = useCallback(async () => { setStudent(studentId ? await getById<Student>(C.students, studentId) : null); }, [studentId]);
  useEffect(() => { setParentPick(''); setTeacherPick(''); void load(); }, [load]);
  const run = async (fn: () => Promise<void>, ok: string) => { try { await fn(); toast.success(ok); await load(); } catch (e) { toast.error(errorMessage(e)); } };
  const linkedParents = parents.data.filter((p) => student?.parentIds?.includes(p.id));
  const linkedTeachers = staff.data.filter((t) => student?.teacherIds?.includes(t.id));
  const freeParents = parents.data.filter((p) => !student?.parentIds?.includes(p.id));
  const freeTeachers = staff.data.filter((t) => t.userUid && !student?.teacherIds?.includes(t.id));
  const row = (key: string, label: string, onRemove: () => void) => (
    <li key={key} className="flex items-center justify-between rounded border border-line px-3 py-1.5 text-sm"><span>{label}</span>
      <Button size="icon" variant="ghost" aria-label={`Remove ${label}`} onClick={onRemove}><X className="h-4 w-4" /></Button></li>
  );
  return (
    <Dialog open={!!studentId} onClose={onClose} title="Linked people" description={student ? fullName(student) : ''} size="sm" footer={<Button onClick={onClose}>Done</Button>}>
      {!student ? <p className="text-sm text-muted">Loading…</p> : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-1.5 text-sm font-semibold">Parents / guardians</h3>
            <ul className="space-y-1.5">{linkedParents.length ? linkedParents.map((p) => row(p.id, `${p.firstName} ${p.lastName}`, () => void run(() => unlinkParent(p, student), 'Parent removed'))) : <li className="text-sm text-muted">None linked yet.</li>}</ul>
            <div className="mt-2 flex gap-2"><Select aria-label="Add parent" value={parentPick} onChange={(e) => setParentPick(e.target.value)}><option value="">Add a parent…</option>{[...freeParents].sort(byName).map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName}</option>)}</Select>
              <Button disabled={!parentPick} onClick={() => { const p = parents.data.find((x) => x.id === parentPick); if (p) void run(() => linkParent(p, student), 'Parent linked'); setParentPick(''); }}>Add</Button></div>
          </section>
          <section>
            <h3 className="mb-1.5 text-sm font-semibold">Teachers</h3>
            <ul className="space-y-1.5">{linkedTeachers.length ? linkedTeachers.map((t) => row(t.id, `${t.firstName} ${t.lastName}`, () => void run(() => unlinkTeacher(t, student), 'Teacher removed'))) : <li className="text-sm text-muted">None linked yet.</li>}</ul>
            <div className="mt-2 flex gap-2"><Select aria-label="Add teacher" value={teacherPick} onChange={(e) => setTeacherPick(e.target.value)}><option value="">Add a teacher…</option>{[...freeTeachers].sort(byName).map((t) => <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>)}</Select>
              <Button disabled={!teacherPick} onClick={() => { const t = staff.data.find((x) => x.id === teacherPick); if (t) void run(() => linkTeacher(t, student), 'Teacher linked'); setTeacherPick(''); }}>Add</Button></div>
            <p className="mt-1 text-xs text-muted">Only staff who already have a login can be linked.</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}

/** Admin sets a new password for a child's username account and reads it out once. */
function ResetPasswordDialog({ student, onClose }: { student: SRow; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState(() => kidPassword());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async () => {
    if (pw.length < 6) return toast.error('The password needs at least 6 characters.');
    setBusy(true);
    try { await resetStudentPassword(student.studentUid, pw); setDone(true); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open onClose={onClose} title="Reset password" description={fullName(student)} size="sm"
      footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={() => void submit()}>Set new password</Button></>}>
      {done ? (
        <div className="space-y-2 text-sm"><p className="text-ok">Password changed. Any device already signed in is signed out.</p>
          <p className="rounded bg-cream p-3 font-mono text-[13px]">Username: {String(student.username ?? '')}<br />Password: {pw}</p><p className="text-xs text-muted">Shown once. Give it to the child or parent.</p></div>
      ) : (
        <div className="space-y-4">
          <Field label="New password" hint="Made for you. You can change it. At least 6 characters.">{(a) => <Input {...a} value={pw} onChange={(e) => setPw(e.target.value.replace(/\s/g, ''))} />}</Field>
          <p className="text-xs text-muted">Username stays <strong>{String(student.username ?? '')}</strong>.</p>
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
  const [linksFor, setLinksFor] = useState<string | null>(null);
  const [resetFor, setResetFor] = useState<SRow | null>(null);
  const [letterFor, setLetterFor] = useState<SRow | null>(null);
  const [promote, setPromote] = useState(false);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  const config: CrudConfig<SRow> = useMemo(() => ({
    collection: C.students, singular: 'Student', plural: 'Students', description: 'Registration, profiles, class allocation and records.', dialogSize: 'xl', auditActions: true,
    canCreate: write, canEdit: write, canDelete: can(role, 'students.delete'),
    fields: [
      { name: 'studentNo', label: 'Admission number', type: 'text', required: true, placeholder: 'e.g. ELA/26/0001', hint: 'Typed in by you. Must be different for every learner.' },
      { name: 'firstName', label: 'First name', type: 'text', required: true }, { name: 'lastName', label: 'Surname', type: 'text', required: true }, { name: 'otherNames', label: 'Other names', type: 'text' },
      { name: 'gender', label: 'Gender', type: 'select', required: true, options: [{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }] }, { name: 'dob', label: 'Date of birth', type: 'date' },
      classRef(), { name: 'programme', label: 'Programme', type: 'select', options: ['Academic', 'Islamic', 'Academic + Islamic', 'Coding / ICT', 'Skills'].map((v) => ({ value: v, label: v })) },
      { name: 'admissionStatus', label: 'Admission status', type: 'select', required: true, defaultValue: 'enrolled', options: ['applicant', 'admitted', 'enrolled', 'graduated', 'withdrawn'].map((v) => ({ value: v, label: v })) },
      { name: 'status', label: 'Student status', type: 'select', required: true, defaultValue: 'active', options: ['active', 'suspended', 'inactive'].map((v) => ({ value: v, label: v })) },
      { name: 'isAdult', label: 'Adult learner (signs in with their own email)', type: 'checkbox', hint: 'Leave unticked for children. They sign in with a username and password.' },
      { name: 'guardianPhone', label: 'Guardian phone', type: 'tel' }, { name: 'address', label: 'Address', type: 'text', span: 2 },
      { name: 'stateOfOrigin', label: 'State of origin', type: 'text' }, { name: 'religion', label: 'Religion', type: 'text' }, { name: 'bloodGroup', label: 'Blood group', type: 'text' }, { name: 'allergies', label: 'Allergies / medical notes', type: 'textarea' },
      { name: 'photoRef', label: 'Photograph (private)', type: 'photo' },
    ],
    columns: [
      { key: 'n', header: 'Student', primary: true, cell: (r) => <div className="flex items-center gap-3"><SecureAvatar name={fullName(r)} collection="students" docId={r.id} photoRef={r.photoRef} legacyUrl={r.photoUrl} /><div><p className="font-medium">{fullName(r)}</p><p className="text-xs text-muted">{r.studentNo}{r.username ? ` · ${r.username}` : ''}</p></div></div> },
      { key: 'c', header: 'Class', cell: (r) => r.className ?? '—' }, { key: 'a', header: 'Admission', cell: (r) => <StatusBadge status={r.admissionStatus} /> }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      { key: 'p', header: 'Parents', cell: (r) => (r.parentIds ?? []).length }, { key: 't', header: 'Teachers', cell: (r) => (r.teacherIds ?? []).length },
    ],
    searchKeys: ['firstName', 'lastName', 'studentNo', 'className'], sort: byName,
    filters: [{ name: 'classId', label: 'Class', options: classes.data.map((c) => ({ value: c.id, label: c.name })) }, { name: 'status', label: 'Status', options: ['active', 'suspended', 'inactive'].map((v) => ({ value: v, label: v })) }],
    exportColumns: [{ header: 'Student No', value: (r) => r.studentNo }, { header: 'Name', value: (r) => fullName(r) }, { header: 'Class', value: (r) => r.className }, { header: 'Status', value: (r) => r.status }],
    beforeSave: async (p, existing) => {
      const no = String(p.studentNo ?? '').trim();
      if (!no) throw new Error('Enter the admission number.');
      if (!existing || existing.studentNo !== no) {
        const same = await listDocs<Student>(C.students, [where('studentNo', '==', no)]);
        const other = same.find((s) => s.id !== existing?.id);
        if (other) throw new Error(`Admission number ${no} already belongs to ${fullName(other)}.`);
      }
      if (existing) return { ...p, studentNo: no };
      return { ...p, studentNo: no, studentUid: '', parentUids: [], parentIds: [], admittedAt: new Date().toISOString().slice(0, 10) };
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
        {write && <Button size="icon" variant="ghost" aria-label="Linked people" onClick={() => setLinksFor(r.id)}><Users className="h-4 w-4" /></Button>}
        {write && <Button size="icon" variant="ghost" aria-label="Link parent" onClick={() => { setLinking(r); setParentId(''); }}><Link2 className="h-4 w-4" /></Button>}
        {write && !r.studentUid && <Button size="icon" variant="ghost" aria-label="Create student login" onClick={() => setAccount(r)}><KeyRound className="h-4 w-4" /></Button>}
        {write && r.studentUid && r.username && <Button size="icon" variant="ghost" aria-label="Reset password" onClick={() => setResetFor(r)}><LockKeyhole className="h-4 w-4" /></Button>}
        {canPrintAdmissionLetter(r) && <Button size="icon" variant="ghost" aria-label="Admission letter" onClick={() => setLetterFor(r)}><Printer className="h-4 w-4" /></Button>}
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
      {account && <AccountDialog open onClose={() => setAccount(null)} roles={['student']} takenUsernames={students.data.map((s) => s.username ?? '').filter(Boolean)}
        defaults={{ name: fullName(account), email: '', role: 'student', studentId: account.id, classId: account.classId, firstName: account.firstName, isAdult: !!account.isAdult }}
        onCreated={async (uid, username) => { await patchDoc(C.students, account.id, { studentUid: uid, ...(username ? { username } : {}) }); }} />}
      <LinkedPeopleDialog studentId={linksFor} onClose={() => setLinksFor(null)} />
      {resetFor && <ResetPasswordDialog student={resetFor} onClose={() => setResetFor(null)} />}
      <AdmissionLetterDialog student={letterFor} onClose={() => setLetterFor(null)} />
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

