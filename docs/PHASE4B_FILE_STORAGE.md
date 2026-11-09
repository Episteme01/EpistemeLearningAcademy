# Phase 4B: File storage without Firebase Storage

## Architecture
| What | Where | Access |
|---|---|---|
| Website images, banners, CMS images, logo, media library (images, audio, documents up to 10 MB) | **Cloudinary** | Public links. Uploads are **signed** by the gateway (no public upload preset). |
| Course thumbnails and CBT question pictures (teachers) | Cloudinary, folder `ela/staff` | Public links |
| Student photos and every user's own profile picture | **Supabase** private bucket `avatars` | Short-lived signed link, only for people allowed to read that student/user record |
| Resources centre uploads | Supabase private bucket `resources` | Signed link, only for the audience the resource is shared with |
| Assignment submissions | Supabase private bucket `submissions` | Signed link for the student, their parents, and academic staff |
| Video | YouTube (unlisted) links in Resources | no upload |
| Fixed site images, logos, fonts | GitHub repo (`public/`) | unchanged |
| Login, data | Firebase Auth + Firestore | unchanged |

### How a request is secured
1. The browser sends the user's Firebase login token to the `files` Edge Function.
2. The function verifies the token's signature against Google's public keys, then reads `users/{uid}` **as that user** (active status and roles).
3. **Upload:** it checks role, file type, size and context (`supabase/functions/files/policy.ts`), then returns a one-time signed upload link (Supabase) or signed parameters (Cloudinary). The path always starts with something the user cannot choose (their uid, or the student id they are authorised for).
4. **Download:** the function reads the referencing Firestore document **with the user's own token**, so the existing Firestore security rules decide access. It then checks the stored path really belongs to that record, and issues a link valid for 5 minutes.
5. Supabase buckets are private with **no storage policies**, so the public and logged-in keys can reach nothing. Size and type limits are also enforced by the buckets.
6. Firestore rules additionally require a submission's file path to be inside the student's own folder, a resource's file inside its creator's folder, and a profile picture inside the user's own folder.

Secrets live only in the Supabase function secrets: `CLOUDINARY_API_SECRET` etc. Nothing secret is in GitHub or the browser.

## Setup (about 30 minutes, free)
### A. Supabase
1. Sign up at supabase.com and create a project (pick an EU region). Save the database password somewhere safe; the app does not need it.
2. **SQL Editor** > New query > paste `supabase/migrations/001_buckets.sql` > Run. This creates the three private buckets.
3. **Edge Functions** > create a function named `files` and paste `supabase/functions/files/index.ts` and `policy.ts` (two files in the same function). If you use the Supabase CLI instead: `supabase functions deploy files --no-verify-jwt`. **JWT verification must be OFF** for this function (the file `supabase/config.toml` sets it).
4. **Edge Functions > Secrets**, add:
   - `FIREBASE_PROJECT_ID` = `episteme-learning-academy`
   - `ALLOWED_ORIGINS` = your site origin, e.g. `https://episteme01.github.io`
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (from step B)
5. Copy the function URL: `https://<project-ref>.supabase.co/functions/v1/files`.

### B. Cloudinary
1. Sign up at cloudinary.com. On the dashboard copy **Cloud name**, **API Key** and **API Secret**. The secret goes only into the Supabase secrets above, never into GitHub or the app.
2. Settings > Security: leave unsigned uploads unused. (No upload preset is needed.)

### C. The app
1. Put the function URL in `src/config/files.json` (`"gatewayUrl"`), or set the GitHub repository variable `VITE_FILES_GATEWAY_URL`. Commit and deploy.
2. Publish `firebase/firestore.rules` in the Firebase console.
3. Optional but recommended: the workflow `.github/workflows/keepalive.yml` pings the function twice a week so the free Supabase project is not paused for inactivity. It reads the same `VITE_FILES_GATEWAY_URL` repository variable.

## Free-plan limits to watch (as published when this was written; check the live pages)
- Supabase free: 1 GB storage, 5 GB egress a month, 50 MB per file, projects pause after about a week of no activity, 500,000 Edge Function calls a month.
- Cloudinary free: 25 shared credits a month (1 credit = 1 GB storage, or 1 GB bandwidth, or 1,000 transformations), 10 MB per image or document, no time limit. Overuse leads to warnings and then partial disabling.
- Photos are not resized in the browser yet. The 2 MB limit and 1 GB total is your real ceiling for student photos and submissions; watch the Supabase dashboard.

## Migrating old Firebase Storage files
Nothing was deleted or rewritten. Every old record stores a plain URL, and records without a new `fileRef` keep using that URL, so old pictures and documents still load as long as the old bucket stays reachable. New uploads use the new services. A read-only **Storage inventory** page (`/app/storage-inventory`, super admin) lists every record still pointing at Firebase Storage so you can re-upload them over time. Do not delete the old bucket until that list is empty.

## Changes in behaviour
- Video upload is gone; use YouTube links in Resources.
- Limits: images 10 MB (photos 2 MB, CBT pictures 3 MB), documents 25 MB in Resources (10 MB in submissions and the public library), audio 50 MB in Resources (10 MB in the public library).
- Student photographs are edited from the student's record (Edit, then Add photo); a new student must be saved first.
- Deleting a resource, replacing a photo or resubmitting work removes the old private file after the new one is saved.
- `firebase/storage.rules` is retired and no longer deployed.

## Not verified here
The Edge Function, Supabase, Cloudinary and Firebase rules could not be run in this environment. The policy logic is unit-tested (`tests/files.test.ts`). Test with real accounts: a student cannot open another student's submission, a parent can see only their child's photo, an expired link fails, a teacher cannot upload a website image, and old Firebase image links still show. The Supabase signed-upload request format was written from its documented API and needs this live check first.
