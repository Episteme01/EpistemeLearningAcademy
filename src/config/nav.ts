import {
  LayoutDashboard, Users, GraduationCap, UserRound, Briefcase, School, BookOpen, CalendarCheck, Wallet, Receipt, FileText,
  ClipboardList, BarChart3, Settings, Globe, Image, Newspaper, Megaphone, Inbox, Video, Award, FileQuestion, Library, Shield,
  ScrollText, Compass, Layers, ListChecks, Tags, PenSquare, Building2, UserPlus, Percent, CalendarDays, ClipboardCheck, Menu as MenuIcon,
  type LucideIcon,
} from 'lucide-react';
import type { Platform, Role } from './permissions';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  platform: Platform;
  roles: Role[];
  group?: string;
  end?: boolean;
}

const LEAD: Role[] = ['super_admin', 'director', 'principal', 'admin'];
const ACADEMIC: Role[] = ['super_admin', 'principal', 'admin', 'teacher'];
const EMS_STAFF: Role[] = ['super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher'];
const CMS_ALL: Role[] = ['super_admin', 'admin', 'cms_editor', 'cms_author'];
const CMS_PUB: Role[] = ['super_admin', 'admin', 'cms_editor'];
const ADMINS: Role[] = ['super_admin', 'admin'];
const ACAD_LEAD: Role[] = ['super_admin', 'principal', 'admin'];
const FIN_VIEW: Role[] = ['super_admin', 'admin', 'finance', 'director', 'principal'];

export const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/app', icon: LayoutDashboard, platform: 'home', end: true,
    roles: ['super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher', 'cms_editor', 'cms_author', 'parent', 'student'] },

  // ---- CMS
  { label: 'Overview', to: '/app/cms', icon: Globe, platform: 'cms', roles: CMS_ALL, end: true },
  { label: 'Pages', to: '/app/cms/pages', icon: FileText, platform: 'cms', roles: CMS_ALL, group: 'Content' },
  { label: 'Blog posts', to: '/app/cms/posts', icon: Newspaper, platform: 'cms', roles: CMS_ALL, group: 'Content' },
  { label: 'Programmes', to: '/app/cms/programmes', icon: Layers, platform: 'cms', roles: CMS_PUB, group: 'Content' },
  { label: 'Categories', to: '/app/cms/categories', icon: Tags, platform: 'cms', roles: CMS_PUB, group: 'Content' },
  { label: 'Announcements', to: '/app/cms/announcements', icon: Megaphone, platform: 'cms', roles: [...CMS_PUB, 'principal'], group: 'Content' },
  { label: 'Homepage & hero', to: '/app/cms/homepage', icon: PenSquare, platform: 'cms', roles: CMS_PUB, group: 'Site' },
  { label: 'Navigation', to: '/app/cms/navigation', icon: MenuIcon, platform: 'cms', roles: CMS_PUB, group: 'Site' },
  { label: 'Media library', to: '/app/cms/media', icon: Image, platform: 'cms', roles: CMS_ALL, group: 'Site' },
  { label: 'Storage inventory', to: '/app/storage-inventory', icon: Library, platform: 'cms', roles: ['super_admin'], group: 'Site' },
  { label: 'Website settings', to: '/app/cms/settings', icon: Settings, platform: 'cms', roles: CMS_PUB, group: 'Site' },
  { label: 'Contact enquiries', to: '/app/cms/enquiries', icon: Inbox, platform: 'cms', roles: [...CMS_PUB, 'principal'], group: 'Inbox' },

  // ---- EMS
  { label: 'Overview', to: '/app/ems', icon: BarChart3, platform: 'ems', roles: ['super_admin', 'director', 'principal', 'admin', 'finance', 'admissions', 'teacher'], end: true },
  { label: 'Students', to: '/app/ems/students', icon: GraduationCap, platform: 'ems', roles: EMS_STAFF, group: 'People' },
  { label: 'Admissions', to: '/app/ems/admissions', icon: UserPlus, platform: 'ems', roles: [...LEAD, 'admissions'], group: 'People' },
  { label: 'Parents', to: '/app/ems/parents', icon: UserRound, platform: 'ems', roles: [...ACAD_LEAD, 'admissions', 'director', 'finance'], group: 'People' },
  { label: 'Staff', to: '/app/ems/staff', icon: Briefcase, platform: 'ems', roles: LEAD, group: 'People' },
  { label: 'Sessions & terms', to: '/app/ems/academic', icon: CalendarDays, platform: 'ems', roles: [...ACAD_LEAD, 'director', 'teacher'], group: 'Academics' },
  { label: 'Classes', to: '/app/ems/classes', icon: School, platform: 'ems', roles: EMS_STAFF, group: 'Academics' },
  { label: 'Subjects', to: '/app/ems/subjects', icon: BookOpen, platform: 'ems', roles: EMS_STAFF, group: 'Academics' },
  { label: 'Departments', to: '/app/ems/departments', icon: Building2, platform: 'ems', roles: LEAD, group: 'Academics' },
  { label: 'Teacher assignments', to: '/app/ems/assignments', icon: ListChecks, platform: 'ems', roles: [...ACAD_LEAD, 'director', 'teacher'], group: 'Academics' },
  { label: 'Attendance', to: '/app/ems/attendance', icon: CalendarCheck, platform: 'ems', roles: [...ACADEMIC, 'director'], group: 'Academics' },
  { label: 'Fee structures', to: '/app/ems/fee-structures', icon: Percent, platform: 'ems', roles: FIN_VIEW, group: 'Finance' },
  { label: 'Invoices', to: '/app/ems/invoices', icon: Receipt, platform: 'ems', roles: FIN_VIEW, group: 'Finance' },
  { label: 'Payments', to: '/app/ems/payments', icon: Wallet, platform: 'ems', roles: FIN_VIEW, group: 'Finance' },
  { label: 'Score entry', to: '/app/ems/results', icon: ClipboardList, platform: 'ems', roles: ACADEMIC, group: 'Results' },
  { label: 'Approvals', to: '/app/ems/approvals', icon: Shield, platform: 'ems', roles: ACAD_LEAD, group: 'Results' },
  { label: 'Report cards', to: '/app/ems/report-cards', icon: ScrollText, platform: 'ems', roles: [...ACADEMIC, 'director'], group: 'Results' },
  { label: 'Grading scales', to: '/app/ems/grading', icon: Compass, platform: 'ems', roles: ACAD_LEAD, group: 'Results' },
  { label: 'Users & access', to: '/app/ems/users', icon: Users, platform: 'ems', roles: ADMINS, group: 'Administration' },
  { label: 'Audit log', to: '/app/ems/audit', icon: Shield, platform: 'ems', roles: ['super_admin', 'director'], group: 'Administration' },
  { label: 'School settings', to: '/app/ems/settings', icon: Settings, platform: 'ems', roles: ADMINS, group: 'Administration' },
  { label: 'Seed demo data', to: '/app/ems/seed', icon: Compass, platform: 'ems', roles: ['super_admin'], group: 'Administration' },
  // parent + student
  { label: 'My children', to: '/app/ems/children', icon: GraduationCap, platform: 'ems', roles: ['parent'], end: true },
  { label: 'My records', to: '/app/ems/my', icon: ScrollText, platform: 'ems', roles: ['student'], end: true },
  { label: 'Announcements', to: '/app/ems/news', icon: Megaphone, platform: 'ems', roles: ['parent', 'student'] },

  // ---- LMS
  { label: 'Overview', to: '/app/lms', icon: Library, platform: 'lms', roles: [...ACADEMIC, 'director', 'student', 'parent'], end: true },
  { label: 'Courses', to: '/app/lms/courses', icon: BookOpen, platform: 'lms', roles: ACADEMIC, group: 'Teach' },
  { label: 'Assignments', to: '/app/lms/assignments', icon: ClipboardList, platform: 'lms', roles: [...ACADEMIC, 'student'], group: 'Teach' },
  { label: 'Quizzes', to: '/app/lms/quizzes', icon: FileQuestion, platform: 'lms', roles: [...ACADEMIC, 'student'], group: 'Teach' },
  { label: 'Timetable', to: '/app/schedule', icon: CalendarDays, platform: 'lms', roles: ['super_admin', 'director', 'principal', 'admin', 'teacher', 'student', 'parent'], group: 'Teach' },
  { label: 'Class attendance', to: '/app/attendance', icon: ClipboardCheck, platform: 'lms', roles: ['super_admin', 'director', 'principal', 'admin', 'teacher', 'student', 'parent'], group: 'Teach' },
  { label: 'Resources', to: '/app/resources', icon: Library, platform: 'lms', roles: ['super_admin', 'director', 'principal', 'admin', 'teacher', 'student', 'parent'], group: 'Teach' },
  { label: 'Live classes', to: '/app/lms/live', icon: Video, platform: 'lms', roles: [...ACADEMIC, 'student', 'parent'], group: 'Teach' },
  { label: 'Certificates', to: '/app/lms/certificates', icon: Award, platform: 'lms', roles: [...ACADEMIC, 'student', 'parent'], group: 'Teach' },
  { label: 'Course catalogue', to: '/app/lms/catalogue', icon: Library, platform: 'lms', roles: ['student'], group: 'Learn' },
  { label: 'My learning', to: '/app/lms/my-courses', icon: GraduationCap, platform: 'lms', roles: ['student'], group: 'Learn' },
  { label: 'Learning progress', to: '/app/lms/progress', icon: BarChart3, platform: 'lms', roles: ['parent'], group: 'Learn' },

  // ---- CBT
  { label: 'Overview', to: '/app/cbt', icon: BarChart3, platform: 'cbt', roles: [...ACADEMIC, 'director'], end: true },
  { label: 'Examinations', to: '/app/cbt/exams', icon: FileText, platform: 'cbt', roles: ACADEMIC, group: 'Examiner' },
  { label: 'Question bank', to: '/app/cbt/questions', icon: FileQuestion, platform: 'cbt', roles: ACADEMIC, group: 'Examiner' },
  { label: 'Results & grading', to: '/app/cbt/results', icon: ClipboardList, platform: 'cbt', roles: [...ACADEMIC, 'director'], group: 'Examiner' },
  { label: 'My examinations', to: '/app/cbt/my-exams', icon: FileText, platform: 'cbt', roles: ['student'], end: true },
];

export function navFor(role: Role | null | undefined, platform: Platform): NavItem[] {
  if (!role) return [];
  return NAV.filter((n) => n.platform === platform && n.roles.includes(role));
}

export function platformsFor(role: Role | null | undefined, allowed: Platform[]): Platform[] {
  return allowed.filter((p) => navFor(role, p).length > 0);
}

