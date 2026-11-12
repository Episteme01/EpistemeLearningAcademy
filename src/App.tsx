import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { firebaseConfigured } from '@/config/env';
import { NAV } from '@/config/nav';
import type { Role } from '@/config/permissions';
import { PortalLayout } from '@/components/layout/PortalLayout';
import { RequireAuth, RequireRole } from '@/features/auth/guards';
import { LoginPage } from '@/features/auth/LoginPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { SetupScreen } from '@/features/setup/SetupScreen';
import { PublicLayout } from '@/features/public/PublicLayout';
import * as P from '@/features/public/pages';
import * as Cms from '@/features/cms/cms';
import * as People from '@/features/ems/people';
import * as Ops from '@/features/ems/operations';
import * as Res from '@/features/ems/results';
import * as Portal from '@/features/ems/portal';
import { SeedPage } from '@/features/ems/seed';
import * as Lms from '@/features/lms/pages';
import * as LmsWork from '@/features/lms/work';
import * as Cbt from '@/features/cbt/pages';
import { MyExamsPage, TakeExamPage } from '@/features/cbt/student';
import { UpdateBanner } from '@/components/common/UpdateBanner';
import { Dashboard } from '@/features/dashboards/Dashboard';
import { CalendarPage } from '@/features/schedule/Calendar';
import { AttendancePage } from '@/features/attendance/AttendancePage';
import { ResourcesPage } from '@/features/resources/ResourcesPage';
import { PaymentReturn } from '@/features/pay/PaymentReturn';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { NoticesPage } from '@/features/notices/NoticesPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { IslamicPage } from '@/features/Islamic/IslamicPage';
import { StorageInventory } from '@/features/media/StorageInventory';

const STAFF_ACADEMIC: Role[] = ['super_admin', 'principal', 'admin', 'teacher'];

/** Wrap an element with the roles declared for that path in the nav config (single source of truth). */
function guard(path: string, el: ReactNode, extra?: Role[]) {
  const roles = extra ?? NAV.filter((n) => n.to === path).flatMap((n) => n.roles);
  return <RequireRole roles={[...new Set(roles)]}>{el}</RequireRole>;
}

export function App() {
  if (!firebaseConfigured) return <SetupScreen />;
  return (
    <>
    <UpdateBanner />
    <PaymentReturn />
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<P.HomePage />} />
        {P.PAGE_SLUGS.map((s) => <Route key={s} path={s} element={<P.ContentPage slug={s} />} />)}
        <Route path="programmes" element={<P.ProgrammesPage />} />
        <Route path="admissions" element={<P.AdmissionsPage />} />
        <Route path="resources" element={<P.ResourcesPage />} />
        <Route path="blog" element={<P.BlogPage />} />
        <Route path="blog/:slug" element={<P.BlogPostPage />} />
        <Route path="islamic" element={<IslamicPage />} />
        <Route path="contact" element={<P.ContactPage />} />
        <Route path="faq" element={<P.FaqPage />} />
        <Route path="search" element={<P.SearchPage />} />
        <Route path="verify/:code" element={<P.VerifyCertificatePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="*" element={<P.NotFound />} />
      </Route>

      <Route path="app" element={<RequireAuth><PortalLayout /></RequireAuth>}>
        <Route index element={<Dashboard />} />
        <Route path="profile" element={<ProfilePage />} />

        {/* CMS */}
        <Route path="cms" element={guard('/app/cms', <Cms.CmsOverview />)} />
        <Route path="cms/pages" element={guard('/app/cms/pages', <Cms.CmsPages />)} />
        <Route path="cms/posts" element={guard('/app/cms/posts', <Cms.CmsPosts />)} />
        <Route path="cms/programmes" element={guard('/app/cms/programmes', <Cms.CmsProgrammes />)} />
        <Route path="cms/categories" element={guard('/app/cms/categories', <Cms.CmsCategories />)} />
        <Route path="cms/islamic" element={guard('/app/cms/islamic', <Cms.CmsIslamic />)} />
        <Route path="cms/announcements" element={guard('/app/cms/announcements', <Cms.CmsAnnouncements />)} />
        <Route path="cms/homepage" element={guard('/app/cms/homepage', <Cms.CmsHomepage />)} />
        <Route path="cms/navigation" element={guard('/app/cms/navigation', <Cms.CmsNavigation />)} />
        <Route path="cms/media" element={guard('/app/cms/media', <Cms.CmsMedia />)} />
        <Route path="notices" element={guard('/app/notices', <NoticesPage />)} />
        <Route path="reports" element={guard('/app/reports', <ReportsPage />)} />
        <Route path="analytics" element={guard('/app/analytics', <AnalyticsPage />)} />
        <Route path="storage-inventory" element={guard('/app/storage-inventory', <StorageInventory />)} />
        <Route path="cms/settings" element={guard('/app/cms/settings', <Cms.CmsSettings />)} />
        <Route path="cms/enquiries" element={guard('/app/cms/enquiries', <Cms.CmsEnquiries />)} />
        <Route path="cms/preview/:kind/:id" element={guard('', <Cms.PreviewPage />, ['super_admin', 'admin', 'cms_editor', 'cms_author'])} />

        {/* EMS */}
        <Route path="ems" element={guard('/app/ems', <Portal.EmsOverview />)} />
        <Route path="ems/students" element={guard('/app/ems/students', <People.StudentsPage />)} />
        <Route path="ems/students/:id" element={guard('', <Portal.StudentProfilePage />, ['super_admin', 'director', 'principal', 'admin', 'admissions', 'finance', 'teacher', 'parent', 'student'])} />
        <Route path="ems/admissions" element={guard('/app/ems/admissions', <Ops.AdmissionsInbox />)} />
        <Route path="ems/parents" element={guard('/app/ems/parents', <People.ParentsPage />)} />
        <Route path="ems/staff" element={guard('/app/ems/staff', <People.StaffPage />)} />
        <Route path="ems/academic" element={guard('/app/ems/academic', <People.AcademicPage />)} />
        <Route path="ems/classes" element={guard('/app/ems/classes', <People.ClassesPage />)} />
        <Route path="ems/subjects" element={guard('/app/ems/subjects', <People.SubjectsPage />)} />
        <Route path="ems/departments" element={guard('/app/ems/departments', <People.DepartmentsPage />)} />
        <Route path="ems/assignments" element={guard('/app/ems/assignments', <People.TeacherAssignmentsPage />)} />
        <Route path="ems/attendance" element={guard('/app/ems/attendance', <Ops.AttendancePage />)} />
        <Route path="ems/fee-structures" element={guard('/app/ems/fee-structures', <Ops.FeeStructuresPage />)} />
        <Route path="ems/invoices" element={guard('/app/ems/invoices', <Ops.InvoicesPage />)} />
        <Route path="ems/payments" element={guard('/app/ems/payments', <Ops.PaymentsPage />)} />
        <Route path="ems/results" element={guard('/app/ems/results', <Res.ResultsEntryPage />)} />
        <Route path="ems/approvals" element={guard('/app/ems/approvals', <Res.ApprovalsPage />)} />
        <Route path="ems/report-cards" element={guard('/app/ems/report-cards', <Res.ReportCardsPage />)} />
        <Route path="ems/grading" element={guard('/app/ems/grading', <Res.GradingPage />)} />
        <Route path="ems/users" element={guard('/app/ems/users', <Ops.UsersPage />)} />
        <Route path="ems/audit" element={guard('/app/ems/audit', <Ops.AuditPage />)} />
        <Route path="ems/settings" element={guard('/app/ems/settings', <Portal.SchoolSettingsPage />)} />
        <Route path="ems/seed" element={guard('/app/ems/seed', <SeedPage />)} />
        <Route path="ems/children" element={guard('/app/ems/children', <Portal.ChildrenPage />)} />
        <Route path="ems/my" element={guard('/app/ems/my', <Portal.MyRecordsPage />)} />
        <Route path="ems/news" element={guard('/app/ems/news', <Portal.NewsPage />)} />

        {/* LMS */}
        <Route path="lms" element={guard('/app/lms', <LmsWork.LmsOverview />)} />
        <Route path="lms/courses" element={guard('/app/lms/courses', <Lms.CoursesPage />)} />
        <Route path="lms/courses/:id/build" element={guard('', <Lms.CourseBuilder />, STAFF_ACADEMIC)} />
        <Route path="lms/catalogue" element={guard('/app/lms/catalogue', <Lms.CataloguePage />)} />
        <Route path="lms/my-courses" element={guard('/app/lms/my-courses', <Lms.MyCoursesPage />)} />
        <Route path="lms/course/:id" element={guard('', <Lms.CoursePlayer />, [...STAFF_ACADEMIC, 'student'])} />
        <Route path="lms/assignments" element={guard('/app/lms/assignments', <LmsWork.LmsAssignmentsPage />)} />
        <Route path="lms/quizzes" element={guard('/app/lms/quizzes', <LmsWork.QuizzesPage />)} />
        <Route path="lms/live" element={guard('/app/lms/live', <CalendarPage liveOnly />)} />
        <Route path="schedule" element={guard('/app/schedule', <CalendarPage />)} />
        <Route path="attendance" element={guard('/app/attendance', <AttendancePage />)} />
        <Route path="resources" element={guard('/app/resources', <ResourcesPage />)} />
        <Route path="lms/certificates" element={guard('/app/lms/certificates', <LmsWork.CertificatesPage />)} />
        <Route path="lms/progress" element={guard('/app/lms/progress', <LmsWork.ProgressPage />)} />

        {/* CBT */}
        <Route path="cbt" element={guard('/app/cbt', <Cbt.CbtOverview />)} />
        <Route path="cbt/exams" element={guard('/app/cbt/exams', <Cbt.ExamsPage />)} />
        <Route path="cbt/exams/:id" element={guard('', <Cbt.ExamEditor />, STAFF_ACADEMIC)} />
        <Route path="cbt/questions" element={guard('/app/cbt/questions', <Cbt.QuestionBankPage />)} />
        <Route path="cbt/results" element={guard('/app/cbt/results', <Cbt.CbtResultsPage />)} />
        <Route path="cbt/my-exams" element={guard('/app/cbt/my-exams', <MyExamsPage />)} />
        <Route path="cbt/take/:examId" element={guard('', <TakeExamPage />, ['student'])} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Route>
    </Routes>
    </>
  );
}
