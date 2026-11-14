# Phase 12: conflict preview, course items, PDF.js, PowerPoint, LaTeX

New packages (run `npm install`): `pdfjs-dist@4.10.38`, `katex`, `@types/katex`. No Firestore index or Supabase change is needed.
Firestore rules are unchanged by this phase (the automatic-attendance rule from Phase 3 is separate).

## 1. Live conflict preview (Schedule a class / Edit class)
`useLiveConflicts.ts` re-runs `checkSchedule` 0.6 s after the form stops changing and shows a status box under the date and time fields: checking, no clashes, errors (block saving) and warnings. The same rules run on Save, so the preview can never disagree with the save check (`scopeTargets` in `lib/schedule/validate.ts` is shared). A teacher can only see their own classes, so a clash with another teacher's class is still found only for leaders; the box says so.

## 2. Course modules: Lesson Studio lessons, quizzes, assignments
In **Courses > Build**, a module item can now be of type *Lesson from the Lesson Studio*, *Quiz* or *Assignment*.
- **Lesson Studio:** pick an approved or published lesson. Learners get a **copy** of the learner-facing sections (objectives, materials, presentation, learner activities, examples, practical, assessment questions, assignment, conclusion, references, links). Teacher activities and the teacher guide are never copied. Press the refresh icon on the item to pull later edits. Teachers can pick their own lessons; leaders can pick any.
- **Quiz / Assignment:** pick one created for this course (Quizzes / Assignments pages, with the Course field set). The learner takes the quiz or submits the work inside the course player. The item completes automatically once a quiz is submitted (graded) or an assignment is handed in. Assignments set only for a class (no course) cannot be embedded.
- The existing course-level "Quizzes" list in the player is unchanged.

## 3. PDF.js reader
PDF lessons and PDF resources open in an in-page reader: real page count, page thumbnails, fit-to-width zoom, arrow-key paging and full screen. PDF.js downloads only when a PDF is opened. If the file cannot be loaded (for example the file host blocks cross-site reads), the previous browser viewer is used automatically.

## 4. PowerPoint in the browser
PowerPoint cannot be drawn by a browser, so **View slides here** uses Microsoft's free Office viewer in an iframe. It is only offered for public https links (private uploads use their short-lived signed link, which stays valid for a few minutes). Nothing is sent to Microsoft until the learner presses the button, and the screen says so. Download remains available. Very large or password-protected decks may not display.

## 5. LaTeX
Write `$x^2+1$` or `\(x^2+1\)` inline, `$$\frac{a}{b}$$` or `\[ ... \]` on its own line. Prices such as "$5 and $10" are not treated as maths; type `\$` for a literal dollar sign. Formulas render (KaTeX, loaded on demand) in rich-text pages and lessons, quiz questions and answers, and CBT exam questions and options. Formula source never becomes markup: only KaTeX output is inserted, after the HTML sanitiser has run.
Not covered: formulas inside question images, and formulas that span formatting tags in the editor (e.g. bold text in the middle of a formula).

## Not verified in the build environment
No `npm install`, Vite build, ESLint, Vitest or browser run was possible when this was written. The pure logic (formula detection, Office link rules, scale maths, item rules, conflict preview and edit-scope logic) was type-checked and run directly. The React screens were syntax-checked only. Run `npm ci && npm run typecheck && npm test` and try each screen once.
