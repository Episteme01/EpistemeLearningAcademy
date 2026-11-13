# Presentations, video learning, course player, parent monitor

## Presentation library — Learning → *Presentations* (`/app/lms/presentations`)
Shows the PDF, PowerPoint and Google Slides items of the **Resources** library (upload and publish them there; private files stay in Supabase and open through the `files` function's short-lived links).
- **PDF:** the browser's own PDF viewer in a frame, with page box, zoom 50–200 %, full screen and an *Open* button. Page/zoom use the `#page=&zoom=` hints, which Chrome/Edge/Firefox desktop honour; some phone browsers cannot show PDFs in a frame, so *Open* is always offered. There is no page count or thumbnail strip (that needs the PDF.js library, not added).
- **Google Slides:** embedded from `docs.google.com/presentation` links only; the deck must be shared "anyone with the link can view".
- **PowerPoint (.ppt/.pptx):** browsers cannot display these, so the viewer says so and offers a download; teachers are advised to export a PDF or share a Slides link.

## Video learning (course lessons of type *Video*)
YouTube, Vimeo, Google Drive previews and direct https .mp4/.webm links (parser shared with Spotlight; anything else is refused).
- Direct files are **measured**: only time actually played counts (skipping ahead adds nothing, replaying does not double-count); position is saved and resumed.
- YouTube/Vimeo/Drive players cannot be measured from this site, so progress shows no "watched %" and the learner confirms with *Mark complete*.

## Course player
Course → modules → lessons (text, video, PDF, presentation, file) → attachments, quizzes. Lesson type **Presentation** takes a Resources item or a Google Slides link. Course Builder gets a *Video completion* choice:
- *Learner confirms* (default), or
- *Needs 90 % tracked playback* — enforced only for direct video files; for embedded players it falls back to learner confirmation.
Opening a lesson records "viewed" in `lessonActivity` but **never completes** it. Assignments and quizzes remain in the existing Assignments/Quizzes pages (not embedded in the player). Lessons written in the Lesson Studio are not yet attachable to course modules.

## Parent learning monitor (`/app/lms/monitor`)
Parents see each linked child's course progress, lessons completed, assignments submitted/marked, days since last learning activity, and teacher messages — all from stored records; with none, it says "No learning activity has been recorded yet". Isolation: queries and rules use `parentUids`; a parent cannot read another family's documents. Teachers/leaders pick class → learner, see the same figures and send a message (≤1,000 chars) that notifies the parent(s) in-app.
Limits: no email/SMS for these messages; a parent linked after a record was written will not see older records until that record is re-saved (existing platform rule, see FIRESTORE_SCHEMA.md); exam/result scores are on the existing Results pages, not repeated here.

## Not run live
Logic is unit-tested (`tests/learning.test.ts`). The viewers, video tracking, rules and monitor pages have been type-checked only; test with real accounts (student, parent, teacher) after deploying and republishing `firestore.rules`.
