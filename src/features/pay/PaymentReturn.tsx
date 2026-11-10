import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { verifyPayment } from '@/services/paystack';
import { errorMessage } from '@/lib/utils';

/** Paystack sends people back to the site with ?reference=... . Confirm it with the server, then show the receipt. */
export function PaymentReturn() {
  const { uid } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const ref = q.get('reference') || q.get('trxref');
    if (!ref || !uid || done.current) return;
    done.current = true;
    void (async () => {
      try {
        let r = await verifyPayment(ref);
        for (let i = 0; i < 3 && r.status === 'pending'; i++) { await new Promise((res) => setTimeout(res, 2500)); r = await verifyPayment(ref); }
        if (r.status === 'success') toast.success(`Payment received. Receipt ${r.receiptNo ?? ''}`.trim());
        else if (r.status === 'failed') toast.error('The payment was not completed. You have not been charged.');
        else toast.success('Payment is still being confirmed. Check Fees in a minute.');
      } catch (e) { toast.error(errorMessage(e)); }
      nav('/app/ems/children', { replace: true });
    })();
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
