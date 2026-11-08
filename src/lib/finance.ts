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
