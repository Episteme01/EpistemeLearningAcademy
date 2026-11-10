import { auth } from '@/config/firebase';
import { filesGatewayUrl } from '@/config/env';
import payConfig from '@/config/pay.json';

/** Paystack function address: from pay.json if set, else next to the file service (same project). */
export const paystackUrl: string = ((payConfig as { paystackUrl?: string }).paystackUrl?.trim().replace(/\/+$/, ''))
  || (filesGatewayUrl.includes('/functions/v1/') ? `${filesGatewayUrl.split('/functions/v1/')[0]}/functions/v1/paystack` : '');
export const paystackOn = paystackUrl !== '';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!paystackOn) throw new Error('Online payment is not switched on yet.');
  const u = auth().currentUser;
  if (!u) throw new Error('Sign in to continue.');
  let r: Response;
  try { r = await fetch(paystackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify(body) }); }
  catch { throw new Error('Could not reach the payment service. Check your connection.'); }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new Error(data.error || `Payment service error (${r.status}).`);
  return data;
}

/** Starts a Paystack checkout for an invoice (the amount is re-checked on the server) and sends the browser there. */
export async function payInvoiceOnline(invoiceId: string, amount?: number): Promise<void> {
  const r = await call<{ authorizationUrl: string }>({ action: 'initialize', invoiceId, ...(amount ? { amount } : {}) });
  window.location.href = r.authorizationUrl;
}

export interface VerifyResult { status: 'success' | 'pending' | 'failed'; receiptNo?: string; amount?: number }
export const verifyPayment = (reference: string) => call<VerifyResult>({ action: 'verify', reference });
