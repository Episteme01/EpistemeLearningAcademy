import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shareLinks } from './lib';

/** Share to any app through the phone's share sheet, or pick a platform / copy the text. */
export function ShareButton({ text, path, className, label = 'Share' }: { text: string; path?: string; className?: string; label?: string }) {
  const [open, setOpen] = useState(false); const [copied, setCopied] = useState(false);
  // always the address this visitor is on, so the link works wherever the site is hosted
  const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = path ? (/^https?:/.test(path) ? path : `${base}${path}`) : `${base}/islamic`;
  const full = `${text}\n\n${url}`;
  const onClick = async () => {
    if (typeof navigator.share === 'function') { try { await navigator.share({ text, url }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; } }
    setOpen((o) => !o);
  };
  const copy = async () => { try { await navigator.clipboard.writeText(full); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt('Copy this text', full); } };
  return (
    <span className={cn('relative inline-block', className)}>
      <button type="button" onClick={() => void onClick()} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-medium text-forest-700 hover:bg-forest-50"><Share2 className="h-3.5 w-3.5" />{label}</button>
      {open && (
        <span role="menu" className="absolute right-0 z-20 mt-1 flex w-44 flex-col rounded-lg border border-line bg-white p-1 text-sm shadow-pop">
          {shareLinks(url, text.slice(0, 240)).map((l) => <a key={l.id} role="menuitem" href={l.href} target="_blank" rel="noopener noreferrer" className="rounded px-3 py-2 hover:bg-forest-50" onClick={() => setOpen(false)}>{l.label}</a>)}
          <button role="menuitem" type="button" onClick={() => void copy()} className="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-forest-50">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copied' : 'Copy text'}</button>
        </span>
      )}
    </span>
  );
}
