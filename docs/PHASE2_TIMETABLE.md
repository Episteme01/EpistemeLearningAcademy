# Phase 2 — Timetable, recurring classes and restricted live-class links

## What it does
- **One calendar** at *Timetable* (`/app/schedule`) with Day, Week, Month and Agenda views, working on phones (week and day become stacked lists; the month grid shows dots and a day list below).
- **Role-aware**: leaders (Super Admin, Admin, Principal, Director) see the school-wide calendar with class/teacher filters; teachers see their own classes; students and parents see only what they are invited to. Parents with several children get a per-child filter and "For <child>" labels.
- **Workspace scoping**: a person who is Teacher + Parent sees only their teaching in the Teacher workspace and only their children's classes in the Parent workspace.
- **Scheduling** (Super Admin, Admin, Principal, Teacher): title, course, subject, class, teacher, date, start/end, location, description, online meeting, repeat rule, audience, notify.
- **Recurrence**: none, daily, weekly (selected weekdays, Mon-first), monthly (clamped to month end); every N days/weeks/months; end after N sessions or on a date; max 150 sessions per series. Each occurrence is its **own document** (`sessions/{seriesId}_{n}`) with its own status, so later attendance records attach to the occurrence.
- **Edit**: this session / this and later / whole series. Bulk edits never touch past, cancelled or individually edited sessions. To change the *repeat pattern* itself, cancel the series and create a new one.
- **Cancel** (one / future / all, with a mandatory reason) and **reschedule** (one session; the original time is kept in `rescheduledFrom`). Nothing is deleted; attendees get in-app notifications; every action is audited.
- **Individual live-class access.** The meeting URL, ID and passcode are in a separate document (`sessionLinks/{sessionId}`). The database releases it only to Super Admin/Admin/Principal, the session's teacher, and — for the invited audience — only while the class is *scheduled* and between **15 minutes before start and 30 minutes after end** (server clock). Hiding it in the interface is not what protects it.
- **Audience**: add a whole class, untick individuals to exclude them, add individuals from other classes. Linked parents/guardians are included automatically from the students' `parentUids`.
- **Access history** (`sessionAccess`, append-only): who viewed or clicked the link, shown to the teacher and leaders. **This is not attendance** — Phase 3 will add verified check-in.
- **Time zones**: stored as UTC; wall-clock input is converted from Africa/Lagos; viewers can switch to their own device time zone.
- The old general **Live classes** list (visible to every signed-in user) is replaced; its collection `liveClasses` is now staff-only and kept only as an archive.

## Schema (new collections)
`timetableSeries`, `sessions`, `sessionLinks`, `sessionAccess` — fields in `src/types/models.ts`. `sessions.viewers` = teacher + learner logins + parent logins, used by the rules. No composite indexes are needed (queries are equality-only on `monthKey` + `viewers`).

## Rules changes
New blocks for the four collections; `liveClasses` read narrowed to academic staff. **Publish `firebase/firestore.rules` again.**

## Not tested / known limits
- No emulator run: please test that a student **not** invited cannot read `sessionLinks/*`, that an invited student is refused before the window, and that a teacher cannot schedule for another teacher.
- Parent links made *after* a session was created are not added automatically; edit the session (or "whole series") and re-save the audience to refresh.
- Students without a login are counted, but only their parents can see the class.
- `viewers` is capped at 250 per session by the rules.
- Removing the online link from a class isn't supported (the link document stays); a Super Admin can delete it in the console.
- Month and agenda views load whole month buckets, which is fine for a school-sized timetable but not designed for thousands of sessions per month.
- Email/SMS reminders are not implemented (in-app notifications only). No Google Calendar/Meet API integration; links are pasted by staff.
