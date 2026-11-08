import type { Invoice, WithId } from '@/types/models';

/**
 * Payment-gateway integration architecture.
 * No gateway is bundled and NO real online payment is processed by this build.
 * To add Paystack/Flutterwave: implement `PaymentProvider`, create the checkout/verify
 * calls in a Cloud Function (secret keys must never reach the browser), and have the
 * verified webhook write the payment through the same ledger path as `recordPayment`.
 */
export interface PaymentProvider {
  id: string;
  name: string;
  configured: boolean;
  createCheckout(invoice: WithId<Invoice>): Promise<{ url: string }>;
}

export const manualProvider: PaymentProvider = {
  id: 'manual', name: 'Manual (cash / bank transfer / POS)', configured: true,
  createCheckout: () => Promise.reject(new Error('Manual payments are recorded by the finance officer.')),
};

export const PROVIDERS: PaymentProvider[] = [
  manualProvider,
  { id: 'paystack', name: 'Paystack (not configured)', configured: false, createCheckout: () => Promise.reject(new Error('Paystack is not configured. See docs/ARCHITECTURE.md.')) },
  { id: 'flutterwave', name: 'Flutterwave (not configured)', configured: false, createCheckout: () => Promise.reject(new Error('Flutterwave is not configured. See docs/ARCHITECTURE.md.')) },
];
