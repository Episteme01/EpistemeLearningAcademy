# Final deliverables (Phases 8–11)

## New / changed Firestore collections
`socialPosts`, `curricula`, `curriculumTopics`, `schemeOfWork`, `lessonPlans`, `lessonGuides`, `lessonActivity`, `learningFeedback` (plus earlier `islamicContent`, `studentCredits`). `lessons` (course lessons) gained optional fields `resourceId`, `resourceTitle`, `slidesUrl`, `completionRule` and type `presentation`.

## Security rules
Republish `firebase/firestore.rules` (Firebase console → Firestore → Rules). Key points: lesson teacher guides are readable only by leaders and assigned teachers; learners read only *published* lessons of their class; only leaders approve/publish; `lessonActivity` is written only by the enrolled learner; `learningFeedback` can be created only by staff and only for the student's real parents.

## Indexes
None to add. If the Firebase console reports a missing index, use its link and add the result to `firebase/firestore.indexes.json`.

## Supabase / Cloudinary / env
No new Supabase function or bucket. Presentations use the existing `resources` private bucket through the `files` function (check `VITE_FILES_GATEWAY_URL` if you set it). No Cloudinary change. No new environment variables.

## Tests
`NODE_PATH=… npx tsx --test tests/*.test.ts`: 155 pass at the time of writing (spotlight, curriculum, lessons, learning, plus all earlier suites). Build, lint, emulator and live-service tests were not possible in the authoring sandbox: the first GitHub Actions run is the first real build.

## Mobile testing checklist (phone, 360–414 px)
1. Spotlight: swipe up/down in the viewer; video loads only on tap.
2. Curriculum / Lesson editor: toolbar wraps, tables and symbol menu work, autosave status line visible.
3. Close the tab mid-edit, reopen: the restore banner appears.
4. PDF presentation: if it does not show in the frame, *Open* works.
5. Direct .mp4 lesson: watched % rises only while playing; *Mark complete* refused below 90 % when the rule is "watch".
6. Parent login: Learning monitor shows only own children.

## Deployment checklist
1. Upload the zip, let GitHub Actions build; read any errors.
2. Republish Firestore rules.
3. Test as: super admin, teacher, student, parent (one of each).
4. Share a Spotlight/Islamic link and confirm it opens (SPA 404 fallback).
5. Update `docs/` if you change behaviour.

## Known limits
- No PDF.js (no page count/thumbnails); PPTX is download-only.
- No LaTeX/MathML; equations use symbols, superscript and subscript.
- Lessons from the Lesson Studio are not yet linkable to course modules; course player does not embed assignments.
- Concurrent edits of one lesson: last save wins.
- Parent/child records written before linking need re-saving to appear.
- Email/SMS for monitor messages and lesson reviews: in-app only.
- Provider APIs for the Islamic portal were not verified live from the sandbox.
