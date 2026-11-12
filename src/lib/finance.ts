/** Pure finance helpers. Money is kept in major units (e.g. NGN) as numbers rounded to 2dp. */
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function invoiceTotal(items: { amount: number }[]): number {
  return round2(items.reduce((s, i) => s + (Number(i.amount) || 0), 0));
}

export function invoiceStatus(total: number, paid: number, dueDate?: string | null, now: Date = new Date(), cancelled = false): InvoiceStatus {
  if (cancelled) return 'cancelled';
  const balance = round2(total - paid);
  if (balance <= 0) return 'paid';
  if (dueDate && new Date(dueDate + 'T23:59:59') < now) return 'overdue';
  return paid > 0 ? 'partial' : 'unpaid';
}

export function applyPayment(invoice: { total: number; paid: number; dueDate?: string | null }, amount: number, now: Date = new Date()) {
  if (!(amount > 0)) throw new Error('Payment amount must be greater than zero.');
  const balance = round2(invoice.total - invoice.paid);
  if (amount > balance + 0.0001) throw new Error('Payment exceeds the outstanding balance.');
  const paid = round2(invoice.paid + amount);
  return { paid, balance: round2(invoice.total - paid), status: invoiceStatus(invoice.total, paid, invoice.dueDate, now) };
}

/* ------------------------------------------------------------------ credits, allocation, reconciliation */

/** Money received before (or beyond) an invoice: it waits on the learner's account until it is applied. */
export interface CreditLike { id: string; remaining: number; termId?: string; structureId?: string; paidAt?: string }

export const validMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && round2(n) === n;

/** A credit can pay an invoice only if it was meant for that term and fee category (empty = any). */
export function creditMatches(c: Pick<CreditLike, 'termId' | 'structureId'>, inv: { termId?: string; structureId?: string }): boolean {
  return (!c.termId || c.termId === inv.termId) && (!c.structureId || c.structureId === inv.structureId);
}

/**
 * Decides how stored credits pay one invoice: oldest credit first, never more than the balance, never negative.
 * Pure: the caller performs the writes (in one transaction) from this plan.
 */
export function planCreditApplication(
  invoice: { total: number; paid: number; termId?: string; structureId?: string; dueDate?: string | null },
  credits: CreditLike[], now: Date = new Date(),
) {
  let balance = round2(invoice.total - invoice.paid);
  const applications: { creditId: string; amount: number }[] = [];
  const ordered = credits.filter((c) => c.remaining > 0 && creditMatches(c, invoice)).sort((a, b) => (a.paidAt ?? '').localeCompare(b.paidAt ?? ''));
  for (const c of ordered) {
    if (balance <= 0) break;
    const amount = round2(Math.min(c.remaining, balance));
    if (amount <= 0) continue;
    applications.push({ creditId: c.id, amount }); balance = round2(balance - amount);
  }
  const applied = round2(applications.reduce((s, a) => s + a.amount, 0));
  const paid = round2(invoice.paid + applied);
  return { applications, applied, paid, balance: round2(invoice.total - paid), status: invoiceStatus(invoice.total, paid, invoice.dueDate, now) };
}

/** What an invoice should say, recomputed from the payments that are linked to it. Used to repair or verify stored totals. */
export function reconcileInvoice(invoice: { total: number; dueDate?: string | null; cancelled?: boolean }, payments: number[], now: Date = new Date()) {
  const paid = round2(payments.reduce((s, p) => s + (p > 0 ? p : 0), 0));
  return { paid, balance: Math.max(0, round2(invoice.total - paid)), status: invoiceStatus(invoice.total, paid, invoice.dueDate, now, invoice.cancelled) };
}

/** One learner's (or a whole school's) position: billed - paid = outstanding, plus any money waiting as credit. */
export function ledgerSummary(invoices: { total: number; paid: number; status: string }[], credits: { remaining: number }[]) {
  const live = invoices.filter((i) => i.status !== 'cancelled');
  const billed = round2(live.reduce((s, i) => s + i.total, 0));
  const paid = round2(live.reduce((s, i) => s + i.paid, 0));
  const creditAvailable = round2(credits.reduce((s, c) => s + Math.max(0, c.remaining), 0));
  return { billed, paid, outstanding: Math.max(0, round2(billed - paid)), creditAvailable };
}

/** Stable key for "this fee category in this term". Old invoices without a structureId fall back to their item labels. */
export function invoiceKey(i: { termId?: string; structureId?: string; items?: { label: string }[] }): string {
  return `${i.termId ?? ''}|${i.structureId || (i.items ?? []).map((x) => x.label).join(',')}`;
}

/** Learners who already have an invoice for this fee category and term (so a second one must not be made). */
export function alreadyInvoiced(existing: { studentId: string; termId?: string; structureId?: string; items?: { label: string }[]; status?: string }[], structure: { id: string; items: { label: string }[] }, termId: string): Set<string> {
  const want = invoiceKey({ termId, structureId: structure.id });
  const wantLegacy = invoiceKey({ termId, items: structure.items });
  return new Set(existing.filter((i) => i.status !== 'cancelled' && (invoiceKey(i) === want || invoiceKey({ termId: i.termId, items: i.items }) === wantLegacy)).map((i) => i.studentId));
}
