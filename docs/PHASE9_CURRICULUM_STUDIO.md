# Curriculum Studio

Where: **LMS → Curriculum** (`/app/lms/curriculum`, detail `/app/lms/curriculum/:id`). Roles: super admin, principal, admin (manage everything and publish); teachers (only curricula they are assigned to, drafts only); director (read).

## What it does
* **Curriculum**: title, level/programme (Early Years … Adult Learning, nothing hard-coded), session, optional term, optional class, subject/course, assigned teachers, objectives, competencies, expected outcomes, standard lesson duration, assessment criteria, reference materials. Duplicate (copies topics and weekly plans as a draft), archive, restore, publish/unpublish (leaders only).
* **Topics → subtopics** (two levels): add, edit, reorder up/down, delete (also removes subtopics and the weekly-plan rows that used them). Duplicate titles and deeper nesting are refused.
* **Scheme of work** per term: week 1–20, topic/subtopic, objectives, activities, materials, assessment, expected outcomes, teacher. Duplicate week/topic entries are refused; a panel lists topics not yet planned in the term. **Print / PDF** (printable page; use the browser's Save as PDF) and **CSV** export.

## Collections (new)
| Collection | Key fields |
|---|---|
| `curricula` | title, level, sessionId/sessionName, termId/termName, classId/className, subjectId/subjectName, teacherUids[], teacherNames[], objectives[], competencies[], outcomes[], lessonDurationMin, assessmentCriteria, references[], status (draft/published/archived), version, duplicatedFrom |
| `curriculumTopics` | curriculumId, parentId ('' = topic), title, order, objectives, outcomes, durationMin |
| `schemeOfWork` | curriculumId, termId, week, topicId, subtopicId, objectives, activities, materials, assessment, outcomes, teacherUid/teacherName, notes |

Relationships use stable document ids (class, subject, session, term, teacher uid). Names are copied for display only.

## Security (firestore.rules)
* `curricula`: read by EMS staff, or any signed-in user once published; create/update by principal/admin/super admin, or by an assigned teacher for a **draft** (a teacher cannot publish, archive or remove themselves); delete by leaders only.
* `curriculumTopics`, `schemeOfWork`: read by EMS staff; write by leaders or the assigned teachers of that curriculum (looked up server-side with `get()`); week must be 1–20.
* No new indexes (all queries filter on one field; sorting is done in the browser).

## Known limits
* The printable view opens in a new window, so the browser must allow pop-ups.
* Two levels only (topic → subtopic). Lessons are authored in the next installment and will link to topics, subtopics and weeks.
* Learners and parents cannot yet see curricula in the interface (the rules already allow reading published ones).
