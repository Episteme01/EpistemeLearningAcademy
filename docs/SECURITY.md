# Security notes

- Never trust the UI. All access control is in `firebase/firestore.rules`; file access is enforced by the `files` Edge Function (see PHASE4B_FILE_STORAGE.md).
- No credentials are in the repo. Web config is injected at build time from GitHub Variables; restrict the API key by HTTP referrer.
- Answer keys live in separate staff-only documents. Students can read exam paper questions only after their attempt document exists, and never the keys.
- CBT timing: the attempt's `startedAt` must equal server `request.time`; later writes are refused after `startedAt + duration + 20 s`. Attempt number and `maxAttempts` (≤5) are checked in rules.
- Public forms are validated in rules (allowed fields, size limits, `status == 'new'`, server timestamp). Add Firebase App Check if spam becomes a problem.
- Audit logs and payments are append-only.
- CMS HTML is sanitised before display.

## Test the rules before launch
```bash
npm i -g firebase-tools
firebase emulators:start --only firestore
```
Write emulator tests (`@firebase/rules-unit-testing`) for: student reading another student's records, parent reading an unlinked child, teacher editing results outside their assignment, student reading `exams/*/keys`, starting an attempt outside the window, a 6th attempt, and writing after the deadline. **These tests are not included and the rules have not been emulator-tested.**
