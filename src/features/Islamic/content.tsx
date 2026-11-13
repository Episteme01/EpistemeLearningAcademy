import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Headphones, Play, X } from 'lucide-react';
import { attachmentUrl, safeFileName } from '@/lib/imageDownload';
import { cn, fmtDate } from '@/lib/utils';
import * as api from './api';
import { useCmsType, type CmsItem } from './cms';
import { ayahOfDay, dailyIndex, fmtCountdown, hijriOf, minutesInZone, nextPrayer, youtubeId } from './lib';
import { usePlayer } from './player';
import { ShareButton } from './share';

const card = 'rounded-xl border border-line bg-white p-4 shadow-sm';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-forest-700 hover:bg-forest-50';
const TZ = 'Africa/Lagos';

function useData<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [s, set] = useState<{ data?: T; error?: boolean }>({});
  useEffect(() => { let live = true; fn().then((data) => live && set({ data })).catch(() => live && set({ error: true })); return () => { live = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, deps);
  return s;
}
export function Embed({ url, title }: { url: string; title: string }) {
  const id = youtubeId(url);
  if (!id) return <a href={url} target="_blank" rel="noopener noreferrer" className={btn}><ExternalLink className="h-4 w-4" />Open video</a>;
  return <div className="aspect-video overflow-hidden rounded-lg bg-black"><iframe title={title} src={`https://www.youtube-nocookie.com/embed/${id}`} loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="h-full w-full border-0" /></div>;
}
const itemText = (i: CmsItem) => [i.title, i.arabic, i.body, i.source ? `Source: ${i.source}` : ''].filter(Boolean).join('\n\n');

/* ------------------------------------------------------------------ Dashboard */
export function Dashboard({ go }: { go: (tab: string) => void }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const place = api.PLACES[0];
  const times = useData(() => api.prayerTimes(place.lat, place.lon, 3, new Date()));
  const verse = useData(() => api.ayahByNumber(ayahOfDay(new Date())));
  const hadith = useData(() => api.nawawiHadith(dailyIndex(new Date(), api.NAWAWI_COUNT) + 1));
  const [preview, setPreview] = useState<number | null>(null);
  const news = useCmsType('news'); const gallery = useCmsType('gallery'); const khutbah = useCmsType('khutbah'); const videos = useCmsType('video');
  const pics = gallery.items.filter((g) => !!g.imageUrl);
  const [yy, mm, dd] = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now).split('-').map(Number);
  const h = hijriOf(new Date(Date.UTC(yy, mm - 1, dd)));
  const nx = times.data ? nextPrayer(times.data.timings, minutesInZone(now, TZ)) : null;
  return (
    <div className="space-y-4">
      <section className="rounded-2xl bg-forest-700 p-6 text-center text-white">
        <p className="font-heading text-5xl tabular-nums tracking-wide" aria-live="off">{now.toLocaleTimeString('en-GB', { timeZone: TZ })}</p>
        <p className="mt-2 text-sm">{now.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p className="text-sm text-gold-300">{h ? `${h.day} ${h.monthName} ${h.year} AH` : ''}</p>
        {nx && <p className="mt-3 rounded-full bg-white/10 px-4 py-2 text-sm">Next prayer in Ilorin: <b>{nx.name}</b> in {fmtCountdown(nx.inMin)}</p>}
        <button className="mt-3 text-xs underline" onClick={() => go('prayer')}>All prayer times</button>
      </section>
      {pics.length > 0 && <section aria-label="Pictures" className="flex snap-x gap-3 overflow-x-auto pb-1">{pics.map((g, k) => <figure key={g.id} className="relative w-64 shrink-0 snap-start overflow-hidden rounded-xl border border-line bg-white"><button type="button" onClick={() => setPreview(k)} aria-label={`Preview picture: ${g.title}`} className="block w-full"><img src={g.imageUrl} alt={g.title} loading="lazy" className="h-40 w-full object-cover" /></button><figcaption className="flex items-start justify-between gap-2 p-2 text-xs text-ink/70"><span>{g.title}</span><button type="button" onClick={() => void saveImage(g.imageUrl!, g.title)} aria-label={`Download picture: ${g.title}`} className="shrink-0 rounded p-1 text-forest-700 hover:bg-forest-50"><Download className="h-4 w-4" /></button></figcaption></figure>)}</section>}
      {preview !== null && <PictureLightbox items={pics} start={preview} onClose={() => setPreview(null)} />}
      <section className={card}>
        <h3 className="font-heading text-lg text-forest-700">Verse of the day</h3>
        {verse.error && <p className="text-sm text-ink/60">Could not load today’s verse.</p>}
        {verse.data && <><p dir="rtl" lang="ar" className="mt-2 font-serif text-2xl leading-[2.2]">{verse.data.arabic}</p><p className="mt-2 text-sm text-ink/75">{verse.data.english}</p><p className="mt-1 text-xs text-ink/55">Qur’an {verse.data.surah}:{verse.data.ayah} · {verse.data.surahName}</p><div className="mt-2 flex gap-2"><ShareButton text={`${verse.data.arabic}\n\n${verse.data.english}\n— Qur’an ${verse.data.surah}:${verse.data.ayah}`} path="/islamic" /><button className={btn} onClick={() => go('quran')}>Read more</button></div></>}
      </section>
      <section className={card}>
        <h3 className="font-heading text-lg text-forest-700">Hadith of the day</h3>
        {hadith.error && <p className="text-sm text-ink/60">Could not load today’s hadith.</p>}
        {hadith.data && <><p className="mt-2 text-sm leading-relaxed">{hadith.data.english}</p><p className="mt-1 text-xs text-ink/55">{hadith.data.reference} · Grading: {hadith.data.grade}</p><div className="mt-2 flex gap-2"><ShareButton text={`${hadith.data.english}\n— ${hadith.data.reference}`} path="/islamic?tab=hadith" /><button className={btn} onClick={() => go('hadith')}>Full hadith</button></div></>}
      </section>
      <section className={card}>
        <h3 className="font-heading text-lg text-forest-700">Islamic news & updates</h3>
        {news.items.length === 0 ? <p className="mt-2 text-sm text-ink/60">No updates have been posted yet. They are added by the school’s editors from the website admin area, each with its source.</p> : <ul className="mt-2 divide-y divide-line">{news.items.slice(0, 6).map((n) => <li key={n.id} className="py-3"><p className="font-medium">{n.title}</p>{n.body && <p className="mt-1 text-sm text-ink/75">{n.body}</p>}<p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink/55">{fmtDate(n.itemDate ?? n.createdAt)}{n.source && <span>Source: {n.source}</span>}{n.link && <a className="underline" href={n.link} target="_blank" rel="noopener noreferrer">Read the report</a>}<ShareButton text={itemText(n)} path="/islamic" /></p></li>)}</ul>}
      </section>
      {khutbah.items[0] && <section className={card}><h3 className="font-heading text-lg text-forest-700">Latest Friday khutbah</h3><p className="mt-1 font-medium">{khutbah.items[0].title}</p><button className={cn(btn, 'mt-2')} onClick={() => go('khutbah')}>Read or listen</button></section>}
      {videos.items[0] && <section className={card}><h3 className="mb-2 font-heading text-lg text-forest-700">Latest video</h3><Embed url={videos.items[0].videoUrl ?? ''} title={videos.items[0].title} /><p className="mt-2 text-sm font-medium">{videos.items[0].title}</p></section>}
    </div>
  );
}

/* ------------------------------------------------------------------ Khutbah */
export function Khutbah() {
  const { items, loading, error } = useCmsType('khutbah');
  const player = usePlayer();
  const [mode, setMode] = useState<'both' | 'arabic' | 'english'>('both');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-ink/60">Show:</span>{([['both', 'Arabic + translation'], ['arabic', 'Arabic'], ['english', 'Translation']] as const).map(([m, l]) => <button key={m} onClick={() => setMode(m)} className={cn(btn, mode === m && 'bg-forest-700 text-white hover:bg-forest-700')}>{l}</button>)}</div>
      {loading && <p className="py-6 text-center text-sm text-ink/60">Loading…</p>}
      {error && <p className={cn(card, 'text-center text-sm')}>Khutbahs could not be loaded. Check your connection.</p>}
      {!loading && !error && items.length === 0 && <p className={cn(card, 'text-center text-sm')}>No khutbah has been published yet. Editors add each Friday’s khutbah (Arabic text, translation, audio or video) from the website admin area.</p>}
      {items.map((k) => (
        <article key={k.id} className={card}>
          <h3 className="font-heading text-lg text-forest-700">{k.title}</h3>
          <p className="text-xs text-ink/55">{fmtDate(k.itemDate ?? k.createdAt)}{k.source ? ` · ${k.source}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {k.audioUrl && <button className={btn} onClick={() => player.playUrl({ title: k.title, subtitle: 'Friday khutbah', src: k.audioUrl! })}><Headphones className="h-4 w-4" />Listen</button>}
            <ShareButton text={`${k.title}${k.body ? '\n\n' + k.body.slice(0, 200) + '…' : ''}`} path="/islamic?tab=khutbah" />
          </div>
          {k.videoUrl && <div className="mt-3"><Embed url={k.videoUrl} title={k.title} /></div>}
          {mode !== 'english' && k.arabic && <p dir="rtl" lang="ar" className="mt-4 whitespace-pre-line font-serif text-xl leading-[2.2]">{k.arabic}</p>}
          {mode !== 'arabic' && k.body && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-ink/85">{k.body}</p>}
        </article>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ Videos */
export const VIDEO_CATEGORIES = [
  { value: 'quran', label: 'Qur’an' }, { value: 'seerah', label: 'Stories (Seerah)' }, { value: 'khutbah', label: 'Admonitions (Khutbah)' },
  { value: 'kids', label: 'Videos for Kids' }, { value: 'other', label: 'Other Videos' },
] as const;
/** Older videos have no category: they stay visible, under "All" and "Other Videos". Nothing in the database is changed. */
export const videoCategory = (i: { category?: string }): string => (VIDEO_CATEGORIES.some((c) => c.value === i.category) ? (i.category as string) : 'other');

export function Videos() {
  const { items, loading, error } = useCmsType('video');
  const [cat, setCat] = useState('all');
  const shown = items.filter((v) => cat === 'all' || videoCategory(v) === cat);
  const count = (c: string) => items.filter((v) => videoCategory(v) === c).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Video categories">
        {[{ value: 'all', label: 'All' }, ...VIDEO_CATEGORIES].map((c) => <button key={c.value} type="button" aria-pressed={cat === c.value} onClick={() => setCat(c.value)} className={cn(btn, cat === c.value && 'bg-forest-700 text-white hover:bg-forest-700')}>{c.label}{!loading && !error && <span className="ml-1 opacity-70">({c.value === 'all' ? items.length : count(c.value)})</span>}</button>)}
      </div>
      {loading && <p className="py-6 text-center text-sm text-ink/60">Loading…</p>}
      {error && <p className={cn(card, 'text-center text-sm')}>Videos could not be loaded.</p>}
      {!loading && !error && items.length === 0 && <p className={cn(card, 'text-center text-sm')}>No videos yet. Editors add admonitions and lectures as YouTube links from the website admin area.</p>}
      {!loading && !error && items.length > 0 && shown.length === 0 && <p className={cn(card, 'text-center text-sm')}>No videos in this category yet.</p>}
      {shown.map((v) => <article key={v.id} className={card}><Embed url={v.videoUrl ?? ''} title={v.title} /><h3 className="mt-3 font-medium">{v.title}</h3>{v.body && <p className="mt-1 text-sm text-ink/75">{v.body}</p>}<div className="mt-2 flex items-center gap-3 text-xs text-ink/55">{v.source && <span>{v.source}</span>}<ShareButton text={v.title} path={v.videoUrl?.startsWith('http') ? v.videoUrl : '/islamic?tab=videos'} /></div></article>)}
    </div>
  );
}

/* ------------------------------------------------------------------ Picture preview + download */
async function saveImage(url: string, title: string): Promise<void> {
  const name = safeFileName(title, url);
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('fetch');
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  } catch {
    // the host does not allow direct fetching: let Cloudinary force the download, otherwise open the picture so it can be saved
    const a = document.createElement('a'); a.href = attachmentUrl(url) ?? url; a.download = name; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.appendChild(a); a.click(); a.remove();
  }
}
export function PictureLightbox({ items, start, onClose }: { items: CmsItem[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const n = items.length; const it = items[i];
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowRight') setI((x) => (x + 1) % n); else if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n); };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prev; };
  }, [n, onClose]);
  if (!it?.imageUrl) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={it.title} className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white">
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="text-xs text-white/70">{i + 1} / {n}</span>
        <span className="flex items-center gap-2">
          <button type="button" onClick={() => void saveImage(it.imageUrl!, it.title)} className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-2 text-sm hover:bg-white/25"><Download className="h-4 w-4" />Download</button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-white/15 p-2 hover:bg-white/25"><X className="h-5 w-5" /></button>
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-2" onClick={onClose}>
        {n > 1 && <button type="button" aria-label="Previous picture" onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + n) % n); }} className="rounded-full bg-white/15 p-3 hover:bg-white/25">‹</button>}
        <img src={it.imageUrl} alt={it.title} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain" decoding="async" />
        {n > 1 && <button type="button" aria-label="Next picture" onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % n); }} className="rounded-full bg-white/15 p-3 hover:bg-white/25">›</button>}
      </div>
      <p className="p-3 text-center text-sm">{it.title}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ Community (public social page) */
const PLATFORMS: Record<string, string> = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', x: 'X', tiktok: 'TikTok', other: 'Link' };
export function CommunityPage() {
  const { items, loading, error } = useCmsType('social');
  const [f, setF] = useState('all');
  const shown = items.filter((i) => f === 'all' || i.platform === f);
  return (
    <div className="bg-cream">
      <header className="bg-forest-700 py-10 text-center text-white"><h1 className="font-heading text-3xl">From our social media</h1><p className="mt-1 text-sm text-gold-300">Where Learning Meets Morality</p></header>
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6 pb-20">
        <div className="flex flex-wrap gap-2">{['all', ...Object.keys(PLATFORMS)].map((p) => <button key={p} onClick={() => setF(p)} className={cn(btn, f === p && 'bg-forest-700 text-white hover:bg-forest-700')}>{p === 'all' ? 'All' : PLATFORMS[p]}</button>)}</div>
        {loading && <p className="py-6 text-center text-sm text-ink/60">Loading…</p>}
        {error && <p className={cn(card, 'text-center text-sm')}>Posts could not be loaded.</p>}
        {!loading && !error && shown.length === 0 && <p className={cn(card, 'text-center text-sm')}>Nothing here yet. Posts are added from Website admin → Islamic content → “Social post”.</p>}
        {shown.map((s) => (
          <article key={s.id} className={card}>
            <p className="text-xs text-ink/55">{PLATFORMS[s.platform ?? 'other'] ?? 'Link'} · {fmtDate(s.itemDate ?? s.createdAt)}</p>
            {s.videoUrl && youtubeId(s.videoUrl) ? <div className="mt-2"><Embed url={s.videoUrl} title={s.title} /></div> : s.imageUrl && <img src={s.imageUrl} alt={s.title} loading="lazy" className="mt-2 max-h-96 w-full rounded-lg object-cover" />}
            <h2 className="mt-2 font-medium">{s.title}</h2>{s.body && <p className="mt-1 text-sm text-ink/75">{s.body}</p>}
            <div className="mt-3 flex flex-wrap gap-2">{s.link && <a href={s.link} target="_blank" rel="noopener noreferrer" className={btn}><Play className="h-4 w-4" />View on {PLATFORMS[s.platform ?? 'other'] ?? 'the platform'}</a>}<ShareButton text={s.title} path={s.link || '/community'} /></div>
          </article>
        ))}
        <p className="text-xs text-ink/55">Posts open on their own platform. <Link to="/islamic" className="underline">Back to the Islamic portal</Link></p>
      </div>
    </div>
  );
}
