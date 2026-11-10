# Student login, linking, admission numbers and letters

## How children sign in
- A child signs in with a **username** (first name + two digits, e.g. `amina07`) and a password. No email is needed.
  The app turns the username into a hidden internal email (`amina07@students.episteme.local`) for Firebase.
- A learner ticked **Adult learner** on the student record signs in with their own email and password, like staff.
- Create the login from **EMS > Students > key icon**. The username and password are shown once.
- Anyone typing `@` in the sign-in box is treated as an email.

## Resetting a child's password (one-time setup)
Firebase does not let a browser change someone else's password, so the file gateway (Supabase Edge Function) does it.

1. Firebase console > Project settings > **Service accounts** > **Generate new private key**. A `.json` file downloads. Keep it private.
2. Supabase > Edge Functions > **Secrets** > add `FIREBASE_SERVICE_ACCOUNT` and paste the **whole contents** of that file.
3. Re-deploy the gateway function with the updated `supabase/functions/files/index.ts` (and leave Verify JWT OFF).
4. EMS > Students > padlock icon on a child with a username account > **Set new password**.

Safety limits (enforced in the function): only super admin, admin, principal and admissions can do it, and only for accounts that
are a single `student` role with a username login. Staff and parent passwords cannot be changed this way. Devices already signed in are signed out.

## Admission numbers
Typed in by hand on the student form. Each must be unique (the form refuses a repeat). Bulk-imported applicants and the demo seed still get an automatic number until you type one.

## Admission letter
Shown for learners whose admission status is *admitted* or *enrolled*:
- Staff: EMS > Students > printer icon, or the student profile > Profile tab.
- Parents and students: My children / My records > Profile tab > **Admission letter**.
Edit the extra note (what to bring, conditions, resumption date) under EMS > School settings > *Admission letter note*.
