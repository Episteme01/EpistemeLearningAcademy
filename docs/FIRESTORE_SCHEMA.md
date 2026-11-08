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
