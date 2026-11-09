import { useEffect, useState } from 'react';

const base = import.meta.env.BASE_URL;

/** Registers the service worker (production only). */
export function registerPwa(): void {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => { navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => undefined); });
}

/** true once a newer deployment than the one running in this tab exists. Checked on open, on return to the app, and every 5 minutes. */
export function useUpdateAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!r.ok) return;
        const v = (await r.json()) as { id?: string };
        if (!stop && v.id && v.id !== __BUILD_ID__) setAvailable(true);
      } catch { /* offline: try again later */ }
    };
    void check();
    const t = setInterval(() => void check(), 5 * 60_000);
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis); window.addEventListener('online', check);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('online', check); };
  }, []);
  return available;
}
