# Firestore collections

Names are defined once in `src/config/collections.ts`; field shapes in `src/types/models.ts`.

**Identity:** `users/{uid}` (role, status, links to student/staff/parent).
**CMS:** `pages`, `posts` (+`revisions`), `programmes`, `categories`, `announcements`, `media`, `settings/{id}` (site, home, navigation, school), `contactEnquiries`, `admissionEnquiries`.
**EMS:** `students` (+`history`), `parents`, `staff`, `classes`, `subjects`, `departments`, `academicSessions`, `terms`, `calendarEvents`, `teacherAssignments/{staffUid}_{classId}_{subjectId}`, `attendance`, `feeStructures`, `invoices`, `payments` (append-only), `gradingScales`, `results`, `reportCards`, `counters`.
**LMS:** `courses`, `modules`, `lessons`, `courseEnrollments`, `lessonProgress`, `assignments`, `submissions`, `quizzes`, `quizKeys` (answers), `quizAttempts`, `liveClasses`, `certificates`.
**CBT:** `questions`, `questionKeys` (staff only), `exams` (+ `paper` without answers, + `keys` staff only), `attempts/{examId}_{uid}_{n}`, `cbtResults`, `examEvents`.
**Shared:** `notifications`, `auditLogs` (append-only).

Parent/student access uses denormalised `parentUids` / `studentUid` fields so rules can prove list queries. If a parent is linked after records were written, re-save those records (or re-link) to refresh the field.

No composite indexes are required by the queries as written; if the console reports one missing, follow its link and add it to `firebase/firestore.indexes.json`.

**Timetable (Phase 2):** `timetableSeries`, `sessions` (one per occurrence; no meeting URL), `sessionLinks/{sessionId}` (secret, window-gated), `sessionAccess` (append-only link views/clicks).

**Spotlight / Curriculum / Lessons / Learning (Phases 8–11):** `socialPosts`; `curricula`, `curriculumTopics`, `schemeOfWork`; `lessonPlans`, `lessonGuides/{lessonId}` (teacher-only); `lessonActivity/{uid}_{lessonId}` (learner's real video/viewing progress, copies `parentUids` from the enrolment); `learningFeedback` (teacher → parent messages, `parentUids` must equal the student's current list); also `islamicContent`, `studentCredits`. The existing `resources` collection is the presentation library (PDF / PowerPoint / Google Slides link). No new composite indexes: every query uses one equality / array-contains filter, or `published`+`classId` / `published`+`visibleTo`, served by automatic indexes.
