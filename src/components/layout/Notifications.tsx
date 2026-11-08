import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { where } from 'firebase/firestore';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { useAuth } from '@/features/auth/AuthContext';
import { markRead } from '@/services/notifications';
import { fmtDate, toDate } from '@/lib/utils';

interface N { title: string; body?: string; link?: string; read: boolean; createdAt?: unknown }

export function Notifications() {
  const { uid } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { data } = useCollection<N>(C.notifications, () => (uid ? [where('userUid', '==', uid)] : null), uid ?? '');
  const items = [...data].sort((a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0)).slice(0, 20);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="relative" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}
        className="relative rounded-md p-2 text-forest-700 hover:bg-forest-50">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-forest-900">{unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-white shadow-pop">
          <p className="border-b border-line px-4 py-3 text-sm font-semibold">Notifications</p>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  className="block w-full border-b border-line/60 px-4 py-3 text-left hover:bg-cream"
                  onClick={() => { void markRead(n.id); setOpen(false); if (n.link) nav(n.link); }}
                >
                  <span className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-400" aria-label="unread" />}
                    <span>
                      <span className="block text-sm font-medium">{n.title}</span>
                      {n.body && <span className="block text-[13px] text-muted">{n.body}</span>}
                      <span className="block text-[11px] text-muted">{fmtDate(n.createdAt, true)}</span>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
