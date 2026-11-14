# Phase 3: Live-class attendance

## How it works
1. **Opening the meeting link records attendance automatically.** When an invited learner presses "Open meeting" in the timetable (before going on to Teams or any external link), a final `present` record is created at once (`method: link_click`, `verified: true`, verified by "Meeting link (automatic)"). No teacher verification is needed. The link click is also still logged in `sessionAccess`. Teachers and leaders opening the link are not recorded as learners.
2. **Learner check-in.** Inside the class window (15 min before the start until the end) a learner presses "check me in". The record is created with the **server time** and status `pending_verification`. Firestore rules make it create-only, so it cannot be edited, repeated (document id is `{sessionId}_{studentUid}`), or made for another learner.
3. **Teacher confirms.** The session's teacher or an admin/principal confirms (no reason needed) or marks/corrects (reason of 5+ characters required). Confirming locks in early / on time / late.
4. **Finalise.** After the class starts, "Finalise" marks every invited learner with no record as Absent (`auto_finalised`).
5. **Corrections** write the record and an `attendanceLog` entry in one batch. The rules reject a change without a matching log entry, and the log is append-only.

## Automatic record: how it is protected
- The Firestore rule `attLinkCreate` allows a learner to create only their own record, only for a class they are invited to, only while the class is scheduled and inside [start - 15 min, end], with `checkInAt == request.time` (server clock) and `method == link_click`.
- Timing is stored empty and derived from the server-stamped `checkInAt`, so a learner cannot choose early / on time / late and device clock errors cannot matter.
- The document id is `{sessionId}_{studentUid}` and records are create-only, so repeated clicks never duplicate or overwrite. A teacher can still correct a record (reason required, written to `attendanceLog`).
- A failed attendance write never blocks joining the class.
- The manual "check me in" button remains as a fallback (in-person classes, or joining without the link); that record stays pending until a teacher confirms it.

## Early / on time / late
Early: before the scheduled start. On time: from the start up to the grace period (default 5 min, `settings/attendance.onTimeGraceMinutes`, editable by admins on the Class attendance page). Late: after that, with "late by N min" measured from the start.

## Statuses
pending verification, present (early / on time / late), left early, absent, excused. "No record" is shown when nothing was recorded.

## Reports (`/app/attendance`)
Filters: date range, academic session, class, course, teacher, learner/child. Group by learner, class, course, teacher or session. CSV export and print. Percentage = confirmed attendances / (expected sessions minus excused). Pending and "no record" are never counted as attended. Learners see only themselves, parents only their children, teachers only their own classes, leaders and directors everyone.

## Schema
- `sessionAttendance/{sessionId}_{studentUid}` (see `SessionAttendance` in `src/types/models.ts`)
- `attendanceLog/{auto}` (see `AttendanceLog`)
- `settings/attendance` `{ onTimeGraceMinutes }`
No composite indexes are needed (equality-only queries).

## Known limits
- A link click proves the learner opened the meeting from the website, not that they stayed in the class. It cannot detect someone sharing their login, or someone who opens the link and leaves. Teachers can correct any record (e.g. Left early).
- The manual check-in is student-asserted; that is why it stays pending until a teacher verifies it.
- There is no check-out or join/leave data. That needs a meeting-provider API (Zoom/Meet/Teams). "Left early" is a manual teacher status.
- Absent records need "Finalise" (an optional Cloud Function could automate it).
- A parent linked after sessions were created only appears on a session once its audience is re-saved.
- The rules and UI were not run against the Firebase emulator in this environment. Test with real accounts after publishing the rules.
