import { Link } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/data';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { ROLE_LABELS, type Role } from '@/config/permissions';
import { fmtDate, fmtMoney } from '@/lib/utils';
import type { CbtResult, Invoice, Student } from '@/types/models';

interface Announcement { title: string; publishedAt?: unknown; createdAt?: unknown }

type Link_ = [label: string, to: string];
const LINKS: Record<Role, Link_[]> = {
  super_admin: [['Users & access', '/app/ems/users'], ['Students', '/app/ems/students'], ['Website pages', '/app/cms/pages'], ['Seed demo data', '/app/ems/seed'], ['Audit log', '/app/ems/audit']],
  admin: [['Users & access', '/app/ems/users'], ['Students', '/app/ems/students'], ['Website pages', '/app/cms/pages'], ['School settings', '/app/ems/settings']],
  director: [['School overview', '/app/ems'], ['Invoices', '/app/ems/invoices'], ['Audit log', '/app/ems/audit'], ['CBT results', '/app/cbt/results']],
  principal: [['Approve results', '/app/ems/approvals'], ['Report cards', '/app/ems/report-cards'], ['Attendance', '/app/ems/attendance'], ['Announcements', '/app/cms/announcements']],
  cms_editor: [['Pages', '/app/cms/pages'], ['Blog posts', '/app/cms/posts'], ['Homepage', '/app/cms/homepage'], ['Media', '/app/cms/media'], ['Enquiries', '/app/cms/enquiries']],
  cms_author: [['Write a post', '/app/cms/posts'], ['Pages', '/app/cms/pages'], ['Media', '/app/cms/media']],
  admissions: [['Admission enquiries', '/app/ems/admissions'], ['Students', '/app/ems/students'], ['Parents', '/app/ems/parents']],
  finance: [['Invoices', '/app/ems/invoices'], ['Payments', '/app/ems/payments'], ['Fee structures', '/app/ems/fee-structures']],
  teacher: [['Enter scores', '/app/ems/results'], ['Attendance', '/app/ems/attendance'], ['My courses', '/app/lms/courses'], ['Question bank', '/app/cbt/questions'], ['Examinations', '/app/cbt/exams']],
  parent: [['My children', '/app/ems/children'], ['Announcements', '/app/ems/news'], ['Learning progress', '/app/lms/progress']],
  student: [['My examinations', '/app/cbt/my-exams'], ['My learning', '/app/lms/my-courses'], ['Assignments', '/app/lms/assignments'], ['My records', '/app/ems/my'], ['Live classes', '/app/lms/live']],
};
const NOTE: Partial<Record<Role, string>> = {
  super_admin: 'You have full access. Create accounts under Users & access and assign roles.',
  finance: 'Record payments and track outstanding balances.',
  admissions: 'Follow up new enquiries and enrol approved applicants.',
  cms_author: 'Your posts are saved as drafts until an editor publishes them.',
};

function Count({ col, label, tone, cons }: { col: string; label: string; tone?: 'gold' | 'ok' | 'danger'; cons?: () => ReturnType<typeof where>[] }) {
  const { data, loading, error } = useCollection<Record<string, unknown>>(col, cons ?? (() => []), 'dash');
  return <StatCard label={label} value={error ? '—' : loading ? '…' : data.length} tone={tone} />;
}

function Money() {
  const { data } = useCollection<Invoice>(C.invoices, () => [], 'dash');
  const out = data.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + (i.balance || 0), 0);
  const paid = data.reduce((s, i) => s + (i.paid || 0), 0);
  return <><StatCard label="Collected" value={fmtMoney(paid)} tone="ok" /><StatCard label="Outstanding" value={fmtMoney(out)} tone="danger" /></>;
}

function Stats({ role }: { role: Role }) {
  const { uid } = useAuth();
  switch (role) {
    case 'super_admin': case 'admin': return <><Count col={C.students} label="Students" /><Count col={C.staff} label="Staff" /><Count col={C.admissionEnquiries} label="Admission enquiries" tone="gold" /><Count col={C.contactEnquiries} label="Contact messages" /></>;
    case 'director': return <><Count col={C.students} label="Students" /><Count col={C.staff} label="Staff" /><Money /></>;
    case 'principal': return <><Count col={C.students} label="Students" /><Count col={C.classes} label="Classes" /><Count col={C.staff} label="Staff" /></>;
    case 'cms_editor': case 'cms_author': return <><Count col={C.posts} label="Posts" /><Count col={C.pages} label="Pages" />{role === 'cms_editor' && <Count col={C.contactEnquiries} label="Messages" tone="gold" />}</>;
    case 'admissions': return <><Count col={C.admissionEnquiries} label="Enquiries" tone="gold" /><Count col={C.students} label="Students" /></>;
    case 'finance': return <Money />;
    case 'teacher': return <><Count col={C.exams} label="My examinations" cons={() => [where('createdBy', '==', uid ?? '')]} /><Count col={C.courses} label="Courses" /></>;
    case 'parent': return <Children />;
    case 'student': return <MyExamsCount />;
  }
}
function Children() {
  const { uid } = useAuth();
  const { data } = useCollection<Student>(C.students, () => (uid ? [where('parentUids', 'array-contains', uid)] : null), uid ?? '');
  return <StatCard label="Children linked" value={data.length} />;
}
function MyExamsCount() {
  const { uid } = useAuth();
  const { data } = useCollection<CbtResult>(C.cbtResults, () => (uid ? [where('uid', '==', uid), where('released', '==', true)] : null), uid ?? '');
  return <StatCard label="Released exam results" value={data.length} tone="gold" />;
}

function Upcoming() {
  const { role } = useAuth();
  const { data } = useCollection<Announcement>(C.announcements, () => [where('status', '==', 'published')], 'dash');
  const rows = data.slice(0, 4);
  if (!rows.length) return null;
  return (<Card className="mt-6"><CardHeader title="Latest announcements" action={role === 'parent' || role === 'student' ? <Link to="/app/ems/news" className="text-sm text-forest underline">All</Link> : undefined} />
    <ul className="divide-y divide-line">{rows.map((a) => <li key={a.id} className="px-4 py-3"><p className="font-medium">{a.title}</p><p className="text-xs text-muted">{fmtDate(a.publishedAt ?? a.createdAt)}</p></li>)}</ul></Card>);
}

export function Dashboard() {
  const { role, profile } = useAuth();
  if (!role) return null;
  return (
    <>
      <PageHeader title={`Welcome, ${profile?.displayName?.split(' ')[0] ?? ''}`} description={NOTE[role] ?? 'Choose where to start.'} actions={<Badge>{ROLE_LABELS[role]}</Badge>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Stats role={role} /></div>
      <Card className="mt-6"><CardHeader title="Quick links" /><CardBody className="flex flex-wrap gap-2">{LINKS[role].map(([l, t]) => <Link key={t} to={t}><Button variant="outline">{l}</Button></Link>)}</CardBody></Card>
      <Upcoming />
    </>
  );
}
