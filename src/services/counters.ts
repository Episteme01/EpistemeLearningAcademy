import { doc, runTransaction } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';

/** Atomically increments a named counter and returns the next value (starting at 1). */
export async function nextNumber(counter: string): Promise<number> {
  const ref = doc(db(), C.counters, counter);
  return runTransaction(db(), async (tx) => {
    const snap = await tx.get(ref);
    const next = (snap.exists() ? (snap.data().value as number) : 0) + 1;
    tx.set(ref, { value: next });
    return next;
  });
}

export const pad = (n: number, width = 4) => String(n).padStart(width, '0');

export async function nextStudentNo(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2);
  return `ELA/${yy}/${pad(await nextNumber(`students-${yy}`))}`;
}
export async function nextStaffNo(): Promise<string> {
  return `ELA/STF/${pad(await nextNumber('staff'), 3)}`;
}
export async function nextInvoiceNo(): Promise<string> {
  const yy = String(new Date().getFullYear());
  return `INV-${yy}-${pad(await nextNumber(`invoices-${yy}`), 5)}`;
}
export async function nextReceiptNo(): Promise<string> {
  const yy = String(new Date().getFullYear());
  return `RCT-${yy}-${pad(await nextNumber(`receipts-${yy}`), 5)}`;
}
