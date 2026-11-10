import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { useToast } from '@/components/ui/overlay';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { useAuth } from '@/features/auth/AuthContext';
import { currentPushState, disablePush, enablePush, notifyCall, notifyOn } from '@/services/push';
import { errorMessage } from '@/lib/utils';

type PushState = Awaited<ReturnType<typeof currentPushState>>;

/** Per-person switches for email and phone notifications (in-app alerts are always on). */
export function NotificationSettings() {
  const { uid, profile } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState(true);
  const [push, setPush] = useState<PushState>('off');
  const [busy, setBusy] = useState(false);
  const usernameLogin = !!profile?.username;
  useEffect(() => {
    if (!uid) return;
    void getDoc(doc(db(), C.notificationPrefs, uid)).then((s) => setEmail(s.exists() ? s.data().email !== false : true)).catch(() => undefined);
    void currentPushState(uid).then(setPush).catch(() => setPush('off'));
  }, [uid]);
  if (!uid) return null;
  const saveEmail = async (v: boolean) => {
    setEmail(v);
    try { await setDoc(doc(db(), C.notificationPrefs, uid), { email: v, updatedAt: serverTimestamp() }, { merge: true }); } catch (e) { toast.error(errorMessage(e)); }
  };
  const togglePush = async () => {
    setBusy(true);
    try {
      if (push === 'on') { await disablePush(uid); setPush('off'); toast.success('Phone notifications off on this device'); }
      else { await enablePush(uid); setPush('on'); toast.success('Phone notifications on for this device'); }
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    setBusy(true);
    try { const r = await notifyCall<{ email: number; push: number; emailConfigured: boolean; pushConfigured: boolean }>({ action: 'test' }); toast.success(`Test sent (in-app${r.email ? ', email' : ''}${r.push ? ', phone' : ''})`); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card className="mt-5 max-w-xl"><CardBody className="space-y-3">
      <h3 className="font-heading font-semibold">Notifications</h3>
      <p className="text-sm text-muted">Class reminders, homework deadlines and school notices always appear in the bell. You can also get them by email and on your phone.</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email && !usernameLogin} disabled={usernameLogin} onChange={(e) => void saveEmail(e.target.checked)} />Email me{usernameLogin ? ' (not available: this account signs in with a username)' : ''}</label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" loading={busy} disabled={push === 'unsupported' || push === 'unconfigured' || push === 'denied'} onClick={() => void togglePush()}>{push === 'on' ? 'Turn off phone notifications' : 'Turn on phone notifications'}</Button>
        {notifyOn && <Button size="sm" variant="ghost" loading={busy} onClick={() => void test()}>Send me a test</Button>}
      </div>
      {push === 'unsupported' && <p className="text-xs text-muted">This browser cannot show phone notifications. On iPhone, open the site in Safari, tap Share, then Add to Home Screen, and open it from there.</p>}
      {push === 'unconfigured' && <p className="text-xs text-muted">Phone notifications have not been set up by the school yet.</p>}
      {push === 'denied' && <p className="text-xs text-muted">Notifications are blocked for this site. Allow them in your browser settings.</p>}
    </CardBody></Card>
  );
}
