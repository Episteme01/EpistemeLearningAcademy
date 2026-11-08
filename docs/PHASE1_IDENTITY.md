# Phase 1 — Unified identity and multiple roles

## What it does
- **One Firebase login per person**, many roles. `users/{uid}.roles` is an array; `role` stays as the primary/default role (backward compatible: documents without `roles` still work and are treated as `[role]`).
- **Workspace switcher** (profile menu, shown only when a person holds 2+ roles). Switching changes the active workspace — dashboard, navigation, route guards — without a new sign-in. The choice is remembered per browser but is re-validated against the server-side roles on every load.
- **Authorisation is the union of assigned roles** in the Firestore and Storage rules. The switcher is UI scoping only; it grants nothing. (Rules cannot know which workspace the browser is "in", so a person who is Teacher + Parent can, by design, be authorised for both sets of data.)
- **Secure role management** (EMS → Users & access → *Roles*): super admins can assign any role; admins can assign any role except `super_admin`/`admin` and cannot edit holders of those roles; nobody can change their own roles/status (rules). People cannot remove their own roles in the UI. Every change writes `role.assign` / `role.remove` audit records, and all audit records now carry `actorRole`.
- **Account linking**: Parents → *Link an existing login* attaches an existing account (e.g. a teacher) to a parent record and adds the Parent role, instead of creating a second login. Many children per parent and many parents per student already work through `parentUids`.
- **Staff who is also a parent / teacher who is also an admin** works through the same mechanism.

## Schema change (non-destructive)
`users/{uid}.roles: string[]` added. No migration is required. To upgrade an existing user, open *Roles* and save; the document gains `roles`.

## Rules changes
`inRoles()/isRole()` use the roles list; `users` create/update validate the role set (`roleShapeOk`) and block admins from granting or touching `super_admin`/`admin`. Storage rules read the same list. Rollback: restore the previous rules; `role` is still written, so the old rules keep working.

## Not tested / known limits
- Rules have **not** been run in the Firebase emulator. Please test: self-promotion refused; admin cannot grant `super_admin`; admin cannot edit a super admin; suspended user blocked.
- Last-super-admin lockout is not prevented by rules; keep at least two super admins.
- A role change reaches an open session through the live profile listener, but rules are evaluated per request.
- Role-specific profile data currently lives in the existing linked records (`students`, `staff`, `parents`) via `studentId`/`staffId`/`parentId`; a person can have one of each.
