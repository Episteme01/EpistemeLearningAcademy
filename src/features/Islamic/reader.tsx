import { useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Play, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import * as api from './api';
import { sanitizeTajweed } from './lib';
import { ShareButton } from './share';
import { usePlayer } from './player';

const card = 'rounded-xl border border-line bg-white p-4 shadow-sm';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-forest-700 hover:bg-forest-50 disabled:opacity-40';
const sel = 'w-full rounded-md border border-line bg-white px-3 py-2 text-sm';
type View = 'arabic' | 'both';
const VIEWS: Array<[View, string]> = [['arabic', 'Arabic only'], ['both', 'Arabic + translation']];

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data?: T; error?: boolean; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; set({ loading: true }); fn().then((data) => live && set({ data, loading: false })).catch(() => live && set({ loading: false, error: true })); return () => { live = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [...deps, n]);
  return { ...s, retry: () => setN((x) => x + 1) };
}
function pref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; } });
  return [v, (x) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* */ } }];
}

export function Quran() {
  const surahs = useLoad(api.listSurahs, []);
  const [unit, setUnit] = useState<api.Unit>('surah');
  const [n, setN] = useState(1);
  const [script, setScript] = pref<api.Script>('ela.islamic.script', 'uthmani');
  const [view, setView] = pref<View>('ela.islamic.view', 'both');
  const [size, setSize] = pref<number>('ela.islamic.size', 28);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.searchEnglish>> | null>(null);
  const [searching, setSearching] = useState(false);
  const [marks, setMarks] = pref<string[]>('ela.islamic.bookmarks', []);
  const player = usePlayer();
  const rows = useLoad(() => api.readerRows(unit, n, script), [unit, n, script]);
  const max = unit === 'surah' ? 114 : unit === 'juz' ? 30 : 604;
  const name = (s: number) => surahs.data?.[s - 1]?.englishName ?? `Surah ${s}`;
  const toggleMark = (k: string) => setMarks(marks.includes(k) ? marks.filter((m) => m !== k) : [...marks, k]);
  const doSearch = async () => { if (q.trim().length < 3) return; setSearching(true); try { setFound(await api.searchEnglish(q.trim())); } catch { setFound([]); } setSearching(false); };
  const html = (r: api.Row) => (r.html ? { dangerouslySetInnerHTML: { __html: sanitizeTajweed(r.arabic) } } : { children: r.arabic });
  const arClass = cn('text-ink', script === 'indopak' ? 'arabic-indopak' : 'font-serif');
  const style = { fontSize: size, lineHeight: 2.2 };
  return (
    <div className="space-y-4">
      <div className={cn(card, 'space-y-3')}>
        <div className="flex flex-wrap gap-2">{(['surah', 'juz', 'page'] as const).map((m) => <button key={m} onClick={() => { setUnit(m); setN(1); }} className={cn(btn, unit === m && 'bg-forest-700 text-white hover:bg-forest-700')}>{m === 'surah' ? 'By surah' : m === 'juz' ? 'By juz’' : 'By page'}</button>)}</div>
        <div className="flex items-center gap-2">
          <button className={btn} aria-label="Previous" disabled={n <= 1} onClick={() => setN(n - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <select aria-label="Position" className={sel} value={n} onChange={(e) => setN(+e.target.value)}>{Array.from({ length: max }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{unit === 'surah' ? `${i}. ${name(i)}` : unit === 'juz' ? `Juz’ ${i}` : `Page ${i}`}</option>)}</select>
          <button className={btn} aria-label="Next" disabled={n >= max} onClick={() => setN(n + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-ink/60">Script<select aria-label="Script" className={cn(sel, 'mt-1')} value={script} onChange={(e) => setScript(e.target.value as api.Script)}>{api.SCRIPTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
          <label className="text-xs text-ink/60">Reading mode<select aria-label="Reading mode" className={cn(sel, 'mt-1')} value={view} onChange={(e) => setView(e.target.value as View)}>{VIEWS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <label className="flex items-center gap-3 text-xs text-ink/60">Text size<input aria-label="Text size" type="range" min={20} max={44} step={2} value={size} onChange={(e) => setSize(+e.target.value)} className="w-full" /></label>
        {unit === 'surah' && player && <button className={btn} onClick={() => { /* handled in Listen tab for reciter choice */ document.dispatchEvent(new CustomEvent('ela-go-listen', { detail: n })); }}><Play className="h-4 w-4" />Listen to this surah</button>}
      </div>
      <div className={card}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doSearch(); }}>
          <input className={sel} placeholder="Search the English translation (3+ letters)" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className={btn} type="submit" aria-label="Search"><Search className="h-4 w-4" /></button>
        </form>
        {searching && <p className="mt-2 text-sm text-ink/60">Searching…</p>}
        {found && !searching && <div className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">{found.length === 0 ? <p className="text-ink/60">No matches.</p> : found.slice(0, 50).map((a) => <button key={a.number} className="block w-full rounded-md border border-line p-2 text-left hover:bg-forest-50" onClick={() => { setUnit('surah'); setN(a.surah!.number); setFound(null); }}><b>{a.surah!.englishName} {a.surah!.number}:{a.numberInSurah}</b> — {a.text}</button>)}{found.length > 50 && <p className="text-xs text-ink/55">Showing the first 50 of {found.length}.</p>}</div>}
      </div>
      {rows.loading && <p className="py-6 text-center text-sm text-ink/60">Loading…</p>}
      {rows.error && <div className={cn(card, 'text-center')}><p className="text-sm">We couldn’t load this text{script === 'tajweed' || script === 'indopak' ? ` (the ${script} script comes from Quran.com — try Uthmani)` : ''}. Check your connection.</p><button className={cn(btn, 'mt-3')} onClick={rows.retry}>Try again</button></div>}
      {rows.data && view === 'arabic' && (
        <div className={cn(card, 'text-justify')} dir="rtl" lang="ar">
          <p className={arClass} style={style}>
            {rows.data.map((r) => <span key={r.key}>{r.ayah === 1 && r.surah !== 1 && r.surah !== 9 && unit !== 'surah' ? <span className="my-2 block text-center text-base text-forest-700" dir="ltr">— {name(r.surah)} —</span> : null}<span {...html(r)} />{' '}<button type="button" onClick={() => toggleMark(r.key)} title={`${r.key}${marks.includes(r.key) ? ' (bookmarked)' : ''}`} className={cn('mx-1 align-middle text-sm', marks.includes(r.key) ? 'text-gold-500' : 'text-forest-500')}>{'﴿'}{r.ayah.toLocaleString('ar-EG')}{'﴾'}</button>{' '}</span>)}
          </p>
        </div>
      )}
      {rows.data && view === 'both' && (
        <ol className="space-y-3">
          {rows.data.map((r) => {
            const marked = marks.includes(r.key);
            return (
              <li key={r.key} className={card}>
                {(unit !== 'surah' && r.ayah === 1) && <p className="mb-2 text-center text-sm font-semibold text-forest-700">{name(r.surah)}</p>}
                <div className="flex items-center justify-between gap-3"><span className="rounded-full bg-forest-50 px-2 py-0.5 text-xs text-forest-700">{r.key}</span>
                  <span className="flex items-center gap-2"><ShareButton text={`${r.arabic.replace(/<[^>]+>/g, '')}\n\n${r.english}\n— Qur’an ${r.key}`} path="/islamic?tab=quran" />
                    <button aria-label={marked ? 'Remove bookmark' : 'Bookmark'} onClick={() => toggleMark(r.key)} className="text-gold-500">{marked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}</button></span></div>
                <p dir="rtl" lang="ar" className={cn('mt-2', arClass)} style={style} {...html(r)} />
                <p className="mt-2 text-sm text-ink/75">{r.english}</p>
              </li>
            );
          })}
        </ol>
      )}
      {marks.length > 0 && <div className={card}><b className="text-sm">Your bookmarks</b> <span className="text-xs text-ink/55">(saved on this device)</span><div className="mt-2 flex flex-wrap gap-2">{marks.map((m) => <button key={m} className={btn} onClick={() => { setUnit('surah'); setN(+m.split(':')[0]); }}>{m}</button>)}</div></div>}
      <p className="mt-4 text-xs text-ink/55">Uthmani and Simple scripts and the English translation (Saheeh International): <a className="underline" href="https://alquran.cloud">AlQuran Cloud</a>. Tajweed and Indo-Pak scripts: <a className="underline" href="https://quran.com">Quran.com</a>. Shown exactly as supplied by the provider. Page numbers follow the Madani mushaf (604 pages).</p>
    </div>
  );
}
