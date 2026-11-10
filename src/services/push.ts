import { deleteDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '@/config/firebase';
import { C } from '@/config/collections';
import { filesGatewayUrl } from '@/config/env';
import notifyConfig from '@/config/notify.json';

/** Public (safe) VAPID key. The private key lives only in Supabase secrets. */
export const vapidPublicKey: string = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim() || notifyConfig.vapidPublicKey || '').trim();
/**
 * Address of the notify function. Taken from notify.json if set, otherwise built from the file-service URL's project
 * (the files function can have any name, e.g. 'quick-worker', so we only reuse the part before /functions/v1/).
 */
const base = filesGatewayUrl.split('/functions/v1/')[0] ?? '';
export const notifyUrl: string = ((notifyConfig as { notifyUrl?: string }).notifyUrl?.trim().replace(/\/+$/, '')) || (filesGatewayUrl && filesGatewayUrl.includes('/functions/v1/') ? `${base}/functions/v1/notify` : '');
export const notifyOn = notifyUrl !== '';

export async function notifyCall<T>(body: Record<string, unknown>): Promise<T> {
  if (!notifyOn) throw new Error('The notification service is not switched on yet. See docs/PHASE5_NOTIFICATIONS_HOMEWORK_ANALYTICS.md.');
  const u = auth().currentUser;
  if (!u) throw new Error('Sign in to continue.');
  let r: Response;
  try { r = await fetch(notifyUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` }, body: JSON.stringify(body) }); }
  catch { throw new Error('Could not reach the notification service. Check your connection.'); }
  const data = (await r.json().catch(() => ({}))) as { error?: string } & T;
  if (!r.ok) throw new Error(data.error || `Notification service error (${r.status}).`);
  return data;
}

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function hash(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function subId(uid: string, endpoint: string) { return `${uid}_${await hash(endpoint)}`; }

export async function currentPushState(uid: string): Promise<'unsupported' | 'unconfigured' | 'denied' | 'on' | 'off'> {
  if (!pushSupported()) return 'unsupported';
  if (!vapidPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  const snap = await getDoc(doc(db(), C.pushSubscriptions, await subId(uid, sub.endpoint))).catch(() => null);
  return snap?.exists() ? 'on' : 'off';
}

export async function enablePush(uid: string): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive push notifications. On iPhone, add the app to your Home Screen first.');
  if (!vapidPublicKey) throw new Error('Push is not set up yet (no VAPID public key).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them in your browser settings and try again.');
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.ready);
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) as BufferSource }));
  const j = sub.toJSON();
  await setDoc(doc(db(), C.pushSubscriptions, await subId(uid, sub.endpoint)), { uid, endpoint: sub.endpoint, keys: { p256dh: j.keys?.p256dh ?? '', auth: j.keys?.auth ?? '' }, userAgent: navigator.userAgent.slice(0, 160), createdAt: serverTimestamp() });
}

export async function disablePush(uid: string): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await deleteDoc(doc(db(), C.pushSubscriptions, await subId(uid, sub.endpoint))).catch(() => undefined);
  await sub.unsubscribe().catch(() => undefined);
}
