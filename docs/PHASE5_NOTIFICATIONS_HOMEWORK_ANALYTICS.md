# Phase 5: notifications, homework, parent view, analytics

Free tier only. Backend = one more Supabase Edge Function (`notify`) + Supabase cron. Email = Brevo free plan.

## What it does
- **Class reminders**: before each timetable session (default 60 and 10 minutes) to the teacher, learners and parents.
- **Homework reminders**: 24 hours before a deadline, to learners who have not handed in, and to their parents.
- **Notices**: staff write a message to a class's parents/students, or (admin/principal) all parents, all students, all staff.
- Every message appears in the bell. Email and phone alerts are optional per person (Profile > Notifications).
- **Homework**: kind (homework/classwork/project), "accept late" switch enforced by Firestore rules (server clock), parents can see their child's homework, new Homework tab on the child page.
- **Analytics** (`/app/analytics`): attendance by class, homework handed in/on-time/average, homework by assignment, learners needing support.

## One-time setup (about 20 minutes, all in a browser)
1. **Brevo** (brevo.com, free): create an account, then Senders & IP > add your sender email (a Gmail address works) and click the verification link. SMTP & API > create an **API key**.
   Note: mail sent "from" a Gmail address may land in spam. Tell users to check spam once. A school domain later fixes this.
2. **Supabase > Edge Functions > Secrets**, add:
   | Name | Value |
   |---|---|
   | `CRON_SECRET` | any long random text |
   | `BREVO_API_KEY` | from Brevo |
   | `MAIL_FROM_EMAIL` | your verified sender |
   | `MAIL_FROM_NAME` | Episteme Learning Academy |
   | `SITE_URL` | https://episteme01.github.io/epistemelearningacademy |
   | `VAPID_SUBJECT` | mailto:your-email |
   (`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `ALLOWED_ORIGINS` already exist from Phase 4B / student login.)
3. **Deploy** (the function must be named exactly `notify`; your file service can keep its own name): `supabase functions deploy notify --no-verify-jwt` (or paste `supabase/functions/notify/index.ts` and `logic.ts` into the dashboard editor and turn JWT verification off).
4. **Cron**: open `supabase/migrations/002_cron.sql`, replace `YOUR_PROJECT_REF` and `YOUR_CRON_SECRET`, run it in SQL Editor.
5. **Firestore rules**: publish `firebase/firestore.rules`.
6. **Phone alerts (optional)**: sign in as super admin > Notices > Reminder settings > *Generate phone-alert keys*. Put the **private** key in Supabase secret `VAPID_PRIVATE_KEY`, the **public** key in secret `VAPID_PUBLIC_KEY` and in `src/config/notify.json`, then redeploy the site. iPhones only get alerts after Add to Home Screen.
7. Existing assignments: open each one and press **Refresh audience** once (new ones fill themselves).

## Data changes
- `assignments`: + `kind`, `allowLate`, `studentUids[]`, `parentViewers[]`
- `submissions`: `parentUids` now filled from the learner's student record
- New: `notices`, `pushSubscriptions`, `notificationPrefs`, `reminderLog` (server only), `settings/notifications`

## Rules changed
- assignments: parents read when their uid is in `parentViewers`
- submissions: create/update refused after the deadline when `allowLate == false`
- notices / pushSubscriptions / notificationPrefs: new blocks

## Tests
87 unit tests pass (notify logic, homework status, analytics, offset parity). Not run here: npm install, Vite build, lint, Firebase/Supabase emulators, real email or push delivery. Verify those on your side.

## Known limits
- Gmail sender deliverability; Brevo free = 300 emails/day (function caps 100 per run).
- `npm:web-push` in Supabase Edge (Deno) is untested here. If push fails, in-app and email still work.
- A notice that crashes mid-send is marked `failed`; delete and resend.
- Parent linked after an assignment was created: press Refresh audience.
- Supabase free projects pause after a week idle (the keep-alive workflow helps).
