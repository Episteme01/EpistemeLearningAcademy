# Installment 2: finance (individual, chosen and class invoicing; previous and advance payments)

## What changed
- **Generate invoices** now has two modes: *A class* (every active learner listed with a tick box; untick anyone; learners who already have this invoice are greyed out) or *Chosen learners* (search by name or admission number, add one or many from any class). A preview line shows how many will be billed and the total.
- **Duplicate protection**: one invoice per learner per fee category and term. Old invoices (made before this update) are recognised too.
- **Previous / advance payment** (button above the invoice list): pick the learner, the fee category and term, amount, date, method and reference. The money gets a receipt number and waits on the learner's account as *credit*.
  - If the learner already has a matching unpaid invoice, it is paid from the credit immediately.
  - Invoices created later are paid from the credit automatically (oldest credit first, never more than the balance, never the wrong term or category).
  - A learner who already paid is therefore never shown as owing the full amount.
  - Part-payments, several instalments and over-payments (the extra stays as credit) all work.
- Parents and learners see **Credit on account** on the Fees tab, plus the invoices, payments and receipts they had before. All screens read the same invoice records, so balances are identical everywhere (`src/lib/finance.ts` is the single calculation layer).
- Deleting an invoice (Installment 1) now returns its payments to the learner as credit.
- Credits are append-only: the app cannot delete them.

## Rules
New `studentCredits` block (finance staff create/update; learner and parent read their own; nobody deletes). Republish `firebase/firestore.rules`.

## Tests
97 passing here, including: advance payment clears an invoice, partial credit, never over-applies, oldest first, wrong term or category ignored, balances reconcile, duplicate detection incl. legacy invoices.

## Not done yet / honest limits
- Payment evidence attachment (photo of a bank slip) is not added yet.
- Refund records are not added yet; use a manual note for now.
- A single payment still pays one invoice at a time (credits can be split across invoices, but one cash payment is not auto-split).
- The new screens were type-checked but not run against your live Firestore. Test with one learner first.
