# Installment 1: real admission-letter PDF, permanent deletion, admission-date audit

## Admission letter PDF
- Admission letter > **Download PDF** builds a real A4 PDF file in the browser (library `pdf-lib`, added to package.json; GitHub installs it on the next deploy).
- The learner's photo (private or public, any format including WebP) is fetched, cropped to a 3:4 passport ratio and **embedded in the file**, so it shows when the PDF is opened offline. Signature, stamp and logo are embedded the same way.
- No photo, or the photo can't be loaded: the letter still downloads with an empty photo box, and a message tells the user.
- Uses the *latest saved* student record, so a new photo or a corrected admission date shows on the next download.
- The Print button still works for printing from the browser.

## Admission date
- Editable in the student form ("Date of admission"). Every change is written to the audit log (`student.admission_date`, old -> new).

## Permanent deletion (staff, parents, students, invoices)
- Trash icon in each row (admins; finance can delete invoices). Shows what will happen, needs the word DELETE.
- Browsers can no longer delete these records directly: Firestore rules now say `delete: false` for them. Only the new Supabase function `records` can, after checking the caller's role.
- What happens
  - **Invoice**: deleted. Its payments are kept as unallocated credit and hidden from parent/learner.
  - **Student**: results, report cards, attendance, course enrolments, submissions deleted and learner removed from sessions/homework lists. Invoices and payments are kept for accounting but cut off from the family and learner. Private photo removed.
  - **Parent**: removed from every child, invoice, payment, session and homework list. Children are never deleted.
  - **Staff**: blocked while the person has upcoming scheduled sessions (reassign or cancel them first). Class-teacher, teaching assignments and course-instructor links are cleared. Past sessions stay as history.
  - **Login account** (optional tick): the Firebase login is deleted. If the person also holds another role, only the role is removed. Super admins and your own account can never be deleted here.
- Before anything is removed the function writes a restricted copy to `deletionArchive` (no app access) and afterwards an `auditLogs` entry.
- Limits: each batch of changes is atomic, but a very large deletion spans several batches. If one fails, nothing is hidden: run the check again and delete again.

## Setup
1. Supabase > Edge Functions > Deploy a new function > Via Editor > paste `supabase/functions/records/index.ts`, name it exactly `records`, **Verify JWT off**. Secrets already exist (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `ALLOWED_ORIGINS`).
2. Publish `firebase/firestore.rules`.
3. Push the code; the next deploy installs `pdf-lib`.

## Tested vs not
- Tested here: PDF generation (5 tests: valid A4 file, photo/signature/stamp embedded, corrupt image ignored, non-Latin names, wrapping); the page was rendered and checked visually.
- Not tested here: the browser download itself, loading a real private photo, and the `records` function against your real Firestore. Try deleting a *test* student, parent and invoice first.
