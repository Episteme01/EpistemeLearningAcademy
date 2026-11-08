# Architecture

- **Single-page app** (Vite, React Router `BrowserRouter`, base path from `import.meta.env.BASE_URL`). GitHub Pages SPA routing uses `public/404.html` (redirects deep links to `/?/path`) plus a restore script in `index.html`.
- **Firebase modular SDK**, initialised lazily in `src/config/firebase.ts`. Config comes only from env (`src/config/env.ts`).
- **Layers:** `src/services/*` (all Firestore/Storage/Auth calls) → `src/hooks/useFirestore.ts` (real-time `onSnapshot` listeners) → `src/features/*` (pages) → `src/components/*` (design system).
- **Pure logic** lives in `src/lib/*` (grading, finance, assessment, CSV, sanitiser) and is unit-tested.
- **RBAC:** roles in `src/config/permissions.ts`; routes are guarded from `src/config/nav.ts`. This only controls the UI — `firebase/firestore.rules` is the real enforcement and reads the role from `users/{uid}`.
- **Platform switcher:** each role sees only the platforms it can use.
- **Account creation** uses a short-lived secondary Firebase app, so no Cloud Function is needed.
- **Optional Cloud Function** (`functions/`) auto-grades CBT on submit; the same logic runs client-side for staff otherwise.
