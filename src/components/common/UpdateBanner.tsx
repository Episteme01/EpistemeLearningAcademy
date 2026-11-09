import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { useUpdateAvailable } from '@/pwa';

/**
 * Tells people a new version is out. It reloads by itself when they move to another page
 * (never while sitting an exam or filling a form on the current page), or immediately on tap.
 */
export function UpdateBanner() {
  const available = useUpdateAvailable();
  const { pathname } = useLocation();
  const first = useRef(pathname);
  const inExam = pathname.includes('/cbt/take/');

  useEffect(() => {
    if (available && !inExam && pathname !== first.current) window.location.reload();
  }, [pathname, available, inExam]);

  if (!available) return null;
  return (
    <div role="status" className="no-print fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg bg-forest-800 px-4 py-3 text-sm text-white shadow-lg">
      <span>{inExam ? 'A new version is ready. It will load after your exam.' : 'A new version of ELA is available.'}</span>
      {!inExam && <button type="button" onClick={() => window.location.reload()} className="inline-flex shrink-0 items-center gap-1.5 rounded bg-gold-400 px-3 py-1.5 font-medium text-forest-900"><RefreshCw className="h-4 w-4" /> Update</button>}
    </div>
  );
}
