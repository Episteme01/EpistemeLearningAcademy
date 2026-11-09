import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/overlay';

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Install support: Android/Chrome shows the native prompt; iPhone/iPad (Safari) shows "Add to Home Screen" steps. */
export function useInstall() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    setInstalled(standalone());
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); };
    const onDone = () => { setInstalled(true); setEvt(null); };
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onDone);
    return () => { window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onDone); };
  }, []);
  const ios = typeof navigator !== 'undefined' && isIos();
  const canInstall = !installed && (!!evt || ios);
  const install = async () => { if (evt) { await evt.prompt(); await evt.userChoice.catch(() => undefined); setEvt(null); } };
  return { canInstall, ios, install, installed };
}

/** Small dismissible card. Remembers a dismissal for 14 days. */
export function InstallBanner({ className = '' }: { className?: string }) {
  const { canInstall, ios, install } = useInstall();
  const [help, setHelp] = useState(false);
  const [hidden, setHidden] = useState(() => { try { return Number(localStorage.getItem('ela.install.dismissed') ?? 0) > Date.now() - 14 * 86_400_000; } catch { return false; } });
  if (!canInstall || hidden) return null;
  const dismiss = () => { try { localStorage.setItem('ela.install.dismissed', String(Date.now())); } catch { /* ignore */ } setHidden(true); };
  return (
    <>
      <div className={`no-print flex items-center gap-3 rounded-lg border border-gold-300 bg-gold-50 px-4 py-3 text-sm ${className}`}>
        <Download className="h-5 w-5 shrink-0 text-forest-700" />
        <p className="flex-1">Install ELA on your phone for quick access.</p>
        <Button size="sm" onClick={() => (ios ? setHelp(true) : void install())}>Install</Button>
        <button type="button" aria-label="Dismiss" onClick={dismiss}><X className="h-4 w-4 text-muted" /></button>
      </div>
      <Dialog open={help} onClose={() => setHelp(false)} title="Install on iPhone or iPad" size="sm" footer={<Button onClick={() => setHelp(false)}>Got it</Button>}>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Open this page in <strong>Safari</strong> (it does not work from inside other apps).</li>
          <li>Tap the <Share className="inline h-4 w-4" /> <strong>Share</strong> button.</li>
          <li>Scroll and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
      </Dialog>
    </>
  );
}
