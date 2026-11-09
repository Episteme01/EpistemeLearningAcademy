# Phase 4: Media library, reusable picker, Resources centre

Firebase Storage is the file store (Blaze plan). Firestore holds the records.

## Media library (`/app/cms/media`)
Multi-file upload, search, filter by type and folder, tags, alt text, description, copy link, delete. Items live in the `media` collection (public by link; files in Storage `public/media`). External image URLs can be added too.

## Reusable picker
`src/components/common/MediaPickerDialog.tsx` is the one picker for the whole app: Library tab (search + type filter) and Upload tab. `kinds` restricts what can be chosen (`['image']`, `['audio','video']`, ...). `ImageField`/`MediaPicker` now use it. `MediaPreview` renders any kind.

## Resources centre (`/app/resources`)
Staff (teachers, admin, principal, super admin) add resources: upload a file (stored in `lms/resources`, readable by signed-in users only), pick from the library, or paste a link (YouTube links embed; other links open in a new tab). Each has title, description, subject, optional class/course, tags, audience (students / parents / teachers) and a published switch. Learners and parents see only published resources shared with their role. Teachers edit and delete only their own; admin/principal/super admin manage all. Directors can view.

## Schema
- `media`: adds `kind`, `folder`, `tags`, `description`, `uploadedByName`.
- `resources`: see `Resource` in `src/types/models.ts`.

## Rules
- Firestore: `resources` block (`resOk` validates shape; read is by role + published + `visibleTo`). Learner queries must include `published == true` and `visibleTo array-contains <role>` (the page does).
- Storage: `lms/**` split into create/update (size-checked) and delete. Previously one `write` rule failed deletes.

## Limits
- Class/course are filter labels, not access control.
- Anyone signed in who knows a private file's URL can fetch it (Storage `lms/` is readable by active users); the list of resources is what is restricted.
- No view or download tracking yet.
- Not run against the emulator or a real build here.
