# Lesson Authoring Studio

**Where:** LMS → Teach → *Lessons* (`/app/lms/lessons`, `/app/lms/lessons/:id`). The older `lessons` collection used by Courses is untouched; the Course Player phase will link the two.

## What a lesson contains
Title, subject, class, topic/subtopic, week, term (taken from the chosen curriculum), duration, objectives, instructional materials, previous knowledge, introduction, lesson presentation, teacher activities, learner activities, examples, practical activities, assessment questions, assignment, conclusion, references and supplementary links.

**Teacher guide** (preparation, teaching guidance, expected answers, differentiation, notes) is a separate document `lessonGuides/{lessonId}`. Security rules let only leaders and the lesson's teachers read it, so learners cannot see it even by querying Firestore directly.

## Editor
Rich text with headings, bold/italic/underline, lists, links, images, quotes, **tables**, superscript/subscript and a maths-symbol menu (π √ ² ± ≤ ≥ ∑ ∫ …). Limit: there is no LaTeX/MathML rendering; equations are written with symbols, superscripts and subscripts.

**Autosave:** every change is copied to this device after 1.5 s; the lesson saves to Firestore every 45 s when something changed and on the Save button. Closing the tab with unsaved changes shows a browser warning, and reopening offers *Restore* if the device copy is newer. If a lesson is edited on two devices at once, the last save wins (no merge).

## Workflow
Draft → In review → Approved → Published → Archived.
| From | To | Who |
|---|---|---|
| Draft | In review | author (needs title, subject, duration, an objective and a presentation) |
| In review | Approved | principal / admin / super admin |
| In review | Draft | author (withdraw) or leader (return with a note) |
| Approved | Published / Draft | leader |
| Published | Approved / Archived | leader |
| Archived | Draft | leader |
Authors can edit only while the lesson is a draft; leaders can edit until archived. Learners see only **published** lessons for their class.

## Firestore
- `lessonPlans/{id}` – fields listed in `LessonPlan` (`src/types/models.ts`); `teacherUids` is copied from the curriculum plus the author.
- `lessonGuides/{id}` – teacher-only guide.
- Rules: see `firebase/firestore.rules` (**republish them**). No new composite indexes: list queries use one equality / array-contains filter, or two equalities for students (status + classId), which Firestore serves from automatic indexes.

## Untested
Logic (workflow, drafts, printable note) has unit tests. The screens, autosave timing, table/symbol tools and the security rules have only been type-checked and read through; they have not been run in a browser or the Firestore emulator.
