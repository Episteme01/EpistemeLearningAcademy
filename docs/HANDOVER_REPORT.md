# Engineering handover report — Episteme Learning Academy (ELA)

Written 12 Nov 2026. Be aware of the one limit that applies to **everything** below: the work was built in a sandbox with no live Firebase, Supabase, Paystack, Brevo, Cloudinary or browser. "Tested" therefore means **automated logic tests (125 passing) and type-checking against the code**, not use on the real site. Anything that touches a live service is listed under section B until you have seen it work.

## A. Completed and tested (logic covered by automated tests)
| Area | What is covered |
|---|---|
| Finance maths | Credit application, allocation, reconciliation, duplicate-invoice prevention, money validation (`tests/finance2.test.ts`) |
| Admission-letter PDF | Valid A4 PDF, learner photo embedded, signature/stamp, corrupt-image tolerance, long text wrapping (`tests/pdf.test.ts`) |
| Islamic portal logic | Audio URL building, reciter parsing, next-prayer countdown, Hijri conversion, verse/hadith daily rotation, YouTube ids, tajweed-markup sanitiser, share links, alarm scheduling/de-duplication, new-post detection (`tests/islamic.test.ts`) |
| Account linking rules | Candidate filtering, duplicate/unsafe link blocking, role patches, unlink safeguards (`tests/linking.test.ts`) |
| Timetable validation | Bad times, teacher/class/duplicate clashes (overlap-aware, across repeats), class–subject, course–instructor, assignment warnings |
| Earlier phases | Recurrence, time zones, attendance, assessment, notices/homework policy, analytics (existing suites) |

## B. Implemented, awaiting external configuration or a live check
| Item | What you must do / check |
|---|---|
| Firestore rules | Publish `firebase/firestore.rules` (adds `studentCredits`, `islamicContent`, delete locks). Re-publish after every update. |
| Supabase `records` function (permanent deletion) | Deploy from `supabase/functions/records/index.ts`, name `records`, Verify JWT **off**. Try on a throwaway student/parent/invoice first. Deletion is atomic per 400-write batch, not across batches. |
| Supabase `quick-worker` (files), `notify`, `paystack` | Already deployed; secrets `FIREBASE_SERVICE_ACCOUNT`, Paystack secret, Brevo key, VAPID keys must stay set in Supabase secrets (never in GitHub). |
| Paystack payments + webhook | Webhook URL registered in Paystack; make one real test payment. |
| Email (Brevo), phone alerts (web push) | `npm:web-push` under Deno is untested. Gmail-sender email may land in spam. |
| Islamic portal providers | Qur'an text (AlQuran Cloud), Tajweed/Indo-Pak scripts (Quran.com), reciters/audio (MP3Quran), prayer times (AlAdhan), hadith (hadith-api via jsDelivr). Response shapes were coded from provider documentation, not live responses. Open each tab once after deploy; confirm the Listen tab shows 50+ reciters. |
| Background audio / lock-screen / reminders | Depends on the visitor's browser; iPhone needs "Add to Home Screen". Reminders ring only while the site/app is open (a website cannot wake a closed browser). |
| Shared-link opening | The deploy workflow now copies `index.html` into each public route folder and `404.html` tolerates double slashes. Confirm by opening a shared `/islamic?tab=hadith` link in a private window. Blog-post links still go through `404.html`. |
| Timetable checks on the live schema | Conflicts are checked by reading sessions by teacher and by class. Teachers can only see their own sessions, so a class clash with a colleague's lesson is detected only when a principal/admin schedules it. |
| Account linking screens | New link/unlink buttons on Staff, Learners and Parents (admins only). Try with a throwaway login. |
| Hosting | GitHub Actions needs the repository variables listed in `.env.example`. Node 20 deprecation notice in Actions is harmless for now. |

## C. Not completed, with reason
| Item | Reason |
|---|---|
| Real run of `npm install`, Vite build, ESLint, Vitest, Firebase emulator | Sandbox has no package/network access. GitHub Actions is the first real build; send any errors back. |
| Browser/E2E and accessibility testing, performance and load testing | Needs a real browser and live backend. |
| Payment evidence uploads and refund records | Not built. |
| One payment auto-split across several invoices | Not built (credits and oldest-first settlement exist). |
| Closed-browser push for anonymous visitors | Would need a public subscription list and an extension of `notify`; not built. |
| Islamic news from live RSS | Not built; editors add news with sources in the CMS. Per-post link previews on social platforms are not possible on GitHub Pages. |
| Firebase Storage / Cloud Functions retained | Not used: by agreement the trusted backend is Supabase Edge Functions (Supabase is **not** a database here; Firestore is the only database). |
| Full security audit by a third party | Rules and functions were self-reviewed only. |
| Timetable: live conflict preview while typing | **Built (Phase 12).** The same check now runs about 0.6 s after the form stops changing. Save still re-checks. |
| PowerPoint inside the browser; PDF.js viewer; LaTeX | **Built (Phase 12)**, see `PHASE12_COURSE_PLAYER_VIEWERS.md`. Needs `npm install` for `pdfjs-dist` and `katex`. |
| Lesson Studio lessons in course modules; quizzes and assignments in the course player | **Built (Phase 12).** |
| Real-time cascade of every relationship edit (e.g. renaming a teacher everywhere) | Records keep stable IDs; display names copied into old documents are not rewritten. |

## D. Deployment checklist
1. Upload the latest zip; wait for the GitHub Actions build to go green.
2. Publish Firestore rules. 3. Deploy/redeploy the Supabase functions listed in B.
4. Open: home, /islamic (every tab), a blog post + Share, Users & Access (Linked-to column), Staff (link icon), Schedule a class (try a clash).
5. Throwaway tests: delete a student/parent/invoice; record an advance payment; one Paystack payment.


## E. Phases 8–11 addendum (Spotlight, Curriculum, Lessons, Presentations, Video, Parent monitor)
See `PHASE8_SOCIAL_SPOTLIGHT.md`, `PHASE9_CURRICULUM_STUDIO.md`, `PHASE10_LESSON_STUDIO.md`, `PHASE11_LEARNING.md`, and `FINAL_DELIVERABLES.md` (collections, rules, env vars, checklists, known limits). All were verified by unit tests and type-checking only; none has been run in a browser, the Firestore emulator or against live services.
