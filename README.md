# Episteme Learning Academy — Digital Platform

One React + Firebase app containing five platforms that share one Firebase project, one login and one design system:

| Platform | Where | Who |
|---|---|---|
| Public website | `/` | everyone |
| CMS | `/app/cms` | admin, CMS editor/author |
| EMS (school management) | `/app/ems` | staff, parents, students |
| LMS (courses) | `/app/lms` | teachers, students, parents |
| CBT (computer-based exams) | `/app/cbt` | teachers, students |

**Stack:** React 19, TypeScript, Vite, Tailwind CSS, Firebase Auth, Cloud Firestore, Firebase Storage (optional), Firebase Security Rules. Hosted on **GitHub Pages** (not Firebase Hosting). No servers, no other database.

> **Honest status.** This code was written in an environment with no npm access, so I could **not** run `npm install`, `vite build`, ESLint, Vitest, or the Firebase rules emulator. What *was* run: the pure-logic tests (grading, CSV import, assessment, finance, shuffle, CSV, permissions) passed 17/17 using Node, and TypeScript was checked with library types missing, which only catches some errors. **Expect to fix a few type or build errors on your first `npm run build`.** The Firestore rules have never been run against the emulator — test them (see `docs/SECURITY.md`) before real student data goes in.

---

## Deploy from your phone (GitHub Pages)

1. **Create a GitHub repository** named `Episteme-Learning-Academy` and upload the contents of this ZIP (extract first; upload the files, not the ZIP). If you use another repo name, set the variable `VITE_BASE_PATH` (step 4) to `/<your-repo-name>/`.
2. **Firebase console** → your project → *Build*:
   - *Authentication* → enable **Email/Password**. Add your GitHub Pages domain (`<user>.github.io`) under *Settings → Authorized domains*.
   - *Firestore Database* → create (production mode).
3. **Publish the security rules** (required before real use). Open `firebase/firestore.rules`, copy everything into *Firestore → Rules → Publish*. If you enable Storage, do the same with `firebase/storage.rules`.
4. **GitHub → Settings → Secrets and variables → Actions → Variables** → add:
   - `VITE_FIREBASE_CONFIG_JSON` — your web app config as one line of JSON, e.g. `{"apiKey":"…","authDomain":"…","projectId":"…","storageBucket":"…","messagingSenderId":"…","appId":"…"}` (Firebase console → Project settings → Your apps). These values are public identifiers; protect them with the rules and by restricting the API key to your site's domain (Google Cloud console → Credentials → HTTP referrers).
   - optional: `VITE_SITE_URL` (e.g. `https://<user>.github.io`), `VITE_BASE_PATH`, `VITE_ENABLE_STORAGE` (`true` only if Storage is available on your plan), `VITE_USE_CLOUD_FUNCTIONS` (`true` only if you deployed `functions/`).
5. **GitHub → Settings → Pages → Source: GitHub Actions.** Push to `main`; the workflow in `.github/workflows/deploy.yml` builds and publishes. It stops with a clear message if the Firebase variable is missing.
6. Custom domain? Set `VITE_BASE_PATH` to `/` and change `pathSegmentsToKeep` to `0` in `public/404.html`.

The site shows a setup screen instead of crashing if Firebase is not configured.

## Create the first Super Admin (one time, secure)

There is deliberately no public sign-up and no default password.

1. Firebase console → *Authentication → Users → Add user* (your email + a strong password). Copy the **User UID**.
2. *Firestore → Start collection* `users` → Document ID = that UID, fields: `email` (string), `displayName` (string), `role` = `super_admin`, `status` = `active`, and (recommended) `roles` = an **array** containing the string `super_admin`. If `roles` is missing, the app treats the single `role` as your only role.
3. Sign in at `/login`. Create every other account from **Users & access**.

## Optional starter data

Signed in as Super Admin: **EMS → Seed demo data** adds classes, subjects, the five legacy courses with lessons, sample questions, and (optionally) two fictional demo accounts marked `devOnly`. Delete them before going live.

## Local development

```bash
cp .env.example .env     # fill in the Firebase values
npm install
npm run dev              # http://localhost:5173/Episteme-Learning-Academy/
npm run typecheck && npm run lint && npm test && npm run build
```

## What costs money / needs a paid plan

- **Everything works on the free Spark plan except** file uploads: Cloud Storage for Firebase may require the Blaze plan. Uploads are off by default (`VITE_ENABLE_STORAGE`). Without them, paste image/file URLs instead.
- **Cloud Functions are optional** (Blaze). Without them, CBT submissions are graded when staff press **Grade submissions**. Nothing essential depends on functions.
- No online payment gateway is connected; payments are recorded manually. `src/services/paymentGateway.ts` is only the integration point.

## Important things to know

- **Lock down the old database.** The previous site used a Realtime Database. If it still exists, set its rules to deny all (`{"rules":{".read":false,".write":false}}`) in the Firebase console.
- **ELA Ignite text, Privacy Policy and Terms are templates.** Review them (and edit in CMS → Pages) before publishing. No testimonials, statistics or accreditations are included.
- **CBT limits.** Timing and attempt limits are enforced by the rules; answers are never exposed to students. But which questions a student draws from a pool is chosen in their browser (rules cannot validate it), and results are computed by staff (or the optional function). Use CBT for assessments where that is acceptable.
- **LMS quizzes** are practice quizzes: scored in the browser after the key is released.
- **Printing/PDF** uses the browser's Print → Save as PDF.
- Logo: replace `public/brand/logo.png`.

## Documentation

`docs/ARCHITECTURE.md` · `docs/FIRESTORE_SCHEMA.md` · `docs/SECURITY.md`


## Install on a phone (PWA) and automatic updates
- **Android (Chrome):** open the site, tap the "Install app" banner, or menu > Install app.
- **iPhone/iPad (Safari):** Share > Add to Home Screen.
- **Updates:** every deployment is detected within about 5 minutes (or when the app is reopened) and an "Update" banner appears; it also refreshes on the next page change. Phones that still hold the old pre-PWA version update once their cache expires or after one refresh. After that, no link resending is needed. GitHub Pages is fine for this.

## File storage (Cloudinary + Supabase, no paid plan)
Firebase Storage is no longer used. Public images go to Cloudinary, private files (student and parent photos, resources, assignment submissions) go to Supabase Storage, and one small Supabase Edge Function signs every upload and download after checking the Firebase login. Follow **docs/PHASE4B_FILE_STORAGE.md** step by step; until `src/config/files.json` has the function URL, upload buttons explain that uploads are not switched on yet.

## Phase 3
See `docs/PHASE3_ATTENDANCE.md`.

## Phase 4
See `docs/PHASE4_MEDIA_RESOURCES.md` (media library, picker, Resources centre).
