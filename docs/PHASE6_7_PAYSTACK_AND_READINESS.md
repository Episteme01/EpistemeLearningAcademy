# Phases 6 and 7: Paystack, class subjects, letters, reports, readiness

## 1. What is new
- **Subjects per class**: Classes form has a tick-list of all subjects (search, select all, clear). Score entry then offers only that class's subjects (a class with none ticked still shows all). Reports > "Classes and subjects" exports them.
- **Editable date of admission**: Students form > Date of admission. Empty = today. Set the real date for learners who joined earlier; it prints on the admission letter.
- **Signature and stamp** (letter, receipt, report card): Settings > School > upload *Signature image* and *School stamp image*, plus signatory name/title. Falls back to the bundled images. Use transparent PNGs.
- **Learner photo** on the admission letter and report card (private photo, loaded through the secure link).
- **Paystack online payment**: parents/students see **Pay online** (full balance) and **Part** on unpaid invoices. Receipts appear automatically with a "PS-" number.
- **Reports** (`/app/reports`): payments in a date range, outstanding fees, student roll, classes and subjects (CSV). Exports are audit-logged. Notices and audience refreshes are audit-logged too.
- Certificates and the audit log already existed; both are unchanged apart from the above.

## 2. Paystack setup (browser only)
1. paystack.com: create an account. Start with **test mode** keys. Go live later by completing their business verification.
2. Supabase > Edge Functions > **Deploy a new function > Via Editor**: paste `supabase/functions/paystack/index.ts`, name it exactly `paystack`, deploy, set **Verify JWT off**.
3. Supabase secrets: `PAYSTACK_SECRET_KEY` (sk_test_... then sk_live_...). Others already exist: `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT`, `SITE_URL`, `ALLOWED_ORIGINS`, `MAIL_FROM_EMAIL`. Redeploy after adding.
4. Paystack > Settings > API Keys & Webhooks > **Webhook URL**: `https://twolvfxldwcedcmqfbdi.supabase.co/functions/v1/paystack` (so payments are recorded even if a parent closes the page).
5. Publish `firebase/firestore.rules` (no change needed for Paystack: the table `paystackTx` is server-only).
6. Test: pay a small test invoice with Paystack's test card, confirm the receipt and balance update.
The secret key is never in GitHub or the app. The server re-checks the invoice, amount and Paystack's own confirmation before recording anything.
Paystack charges the school a fee per transaction (you receive the amount minus the fee). This is Paystack's pricing, not ours.

## 3. Payment rules
NGN invoices only; minimum NGN 100 (or the balance if smaller); cannot exceed the balance; payers need an email on their profile (learners with a username login use the school sender address instead).

## 4. Data and rule changes
- `classes`: + `subjectIds[]`, `subjectNames[]`
- `settings/school`: + `signatureUrl`, `stampUrl`, `signatoryName`, `signatoryTitle`
- `students.admittedAt` is now editable
- New server-only `paystackTx/{reference}`; payments gain `method: 'online'`, `gateway`
- Rules: unchanged in this round (default deny covers `paystackTx`)

## 5. Production readiness (honest status)
Verified here: 87 unit tests pass; changed files type-check apart from errors caused by libraries missing in this sandbox; all Edge Function files pass a syntax check.
**Not verified here, please test on the live site:** npm install, Vite build, lint, Firebase and Supabase running together, a real Paystack payment (test then live), real email and phone push delivery, printing on an actual phone.

Go-live checklist:
- [ ] Deploy workflow is green on GitHub.
- [ ] Functions deployed with Verify JWT off: `quick-worker` (files), `notify`, `paystack`.
- [ ] `002_cron.sql` run; a reminder arrives for a test class.
- [ ] Firestore rules published.
- [ ] Paystack test payment updates the invoice; webhook set; then switch to live keys.
- [ ] Signature and stamp uploaded; print an admission letter and a receipt.
- [ ] Existing assignments: Refresh audience.
- [ ] Back up Firestore (export) before the term starts.

## 6. Known limits
- Signature/stamp images are public URLs (Cloudinary), so anyone with the link could copy them. Keep them modest and watermark-free; receipts carry unique numbers.
- Paystack returns the user to the site root; they are then sent to the Fees tab. If the page was closed, the webhook records the payment.
- A reversed or charged-back payment must be handled by finance staff manually (ledger is append-only).
- The notify/paystack functions on the Supabase free plan pause with the project after about a week idle.
