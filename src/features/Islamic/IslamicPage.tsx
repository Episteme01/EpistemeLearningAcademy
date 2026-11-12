import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Pause, Play, Repeat, RotateCcw, Search, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { db } from '@/config/firebase';
import { cn } from '@/lib/utils';
import * as api from './api';
import { ADHKAR, ADHKAR_GROUPS, audioUrl, dailyIndex, fmtCountdown, hijriOf, minutesInZone, nextPrayer, PRAYERS, surahsAvailable, TAJWEED, type Adhkar, type Reciter } from './lib';

const TABS = [['quran', 'Qur’an'], ['listen', 'Listen'], ['prayer', 'Prayer times'], ['hadith', 'Hadith'], ['adhkar', 'Adhkar'], ['tajweed', 'Tajweed'], ['calendar', 'Calendar']] as const;
type Tab = (typeof TABS)[number][0];

const cardRow = 'rounded-xl border border-line bg-white p-4 shadow-sm flex flex-col gap-3';
const card = 'rounded-xl border border-line bg-white p-4 shadow-sm';
const btn = 'inline-flex items-center justify-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-forest-700 hover:bg-forest-50 disabled:opacity-40';
const sel = 'w-full rounded-md border border-line bg-white px-3 py-2 text-sm';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [n, setN] = useState(0);
  useEffect(() => { let live = true; set({ loading: true }); fn().then((data) => live && set({ data, loading: false })).catch((e) => live && set({ loading: false, error: e instanceof Error ? e.message : 'Could not load' })); return () => { live = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [...deps, n]);
  return { ...s, retry: () => setN((x) => x + 1) };
}
function Status({ s, what }: { s: { loading: boolean; error?: string; retry: () => void }; what: string }) {
  if (s.loading) return <p className="py-6 text-center text-sm text-ink/60">Loading {what}…</p>;
  if (s.error) return <div className={cn(card, 'text-center')}><p className="text-sm">We couldn’t load {what} right now. Check your connection and try again.</p><button className={cn(btn, 'mt-3')} onClick={s.retry}><RotateCcw className="h-4 w-4" />Try again</button></div>;
  return null;
}
function store<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : init; } catch { return init; } });
  return [v, (x) => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch { /* private mode */ } }];
}
const Attribution = ({ children }: { children: React.ReactNode }) => <p className="mt-4 text-xs text-ink/55">{children}</p>;

/* ------------------------------------------------------------------ Qur'an */
function Quran() {
  const surahs = useAsync(api.listSurahs, []);
  const [mode, setMode] = useState<'surah' | 'juz'>('surah');
  const [n, setN] = useState(1);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Awaited<ReturnType<typeof api.searchEnglish>> | null>(null);
  const [searching, setSearching] = useState(false);
  const [marks, setMarks] = store<string[]>('ela.islamic.bookmarks', []);
  const passage = useAsync(() => (mode === 'surah' ? api.surahText(n) : api.juzText(n)), [mode, n]);
  const max = mode === 'surah' ? 114 : 30;
  const info = surahs.data?.find((s) => s.number === n);
  const toggle = (key: string) => setMarks(marks.includes(key) ? marks.filter((m) => m !== key) : [...marks, key]);
  const doSearch = async () => { if (q.trim().length < 3) return; setSearching(true); try { setFound(await api.searchEnglish(q.trim())); } catch { setFound([]); } setSearching(false); };
  return (
    <div className="space-y-4">
      <div className={cardRow}>
        <div className="flex gap-2">
          {(['surah', 'juz'] as const).map((m) => <button key={m} onClick={() => { setMode(m); setN(1); }} className={cn(btn, mode === m && 'bg-forest-700 text-white hover:bg-forest-700')}>{m === 'surah' ? 'By surah' : 'By juz’'}</button>)}
        </div>
        <div className="flex items-center gap-2">
          <button className={btn} aria-label="Previous" disabled={n <= 1} onClick={() => setN(n - 1)}><ChevronLeft className="h-4 w-4" /></button>
          <select aria-label={mode === 'surah' ? 'Choose surah' : 'Choose juz'} className={sel} value={n} onChange={(e) => setN(+e.target.value)}>
            {Array.from({ length: max }, (_, i) => i + 1).map((i) => <option key={i} value={i}>{mode === 'surah' ? `${i}. ${surahs.data?.[i - 1]?.englishName ?? 'Surah ' + i}` : `Juz’ ${i}`}</option>)}
          </select>
          <button className={btn} aria-label="Next" disabled={n >= max} onClick={() => setN(n + 1)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className={card}>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void doSearch(); }}>
          <input className={sel} placeholder="Search the English translation (3+ letters)" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className={btn} type="submit" aria-label="Search"><Search className="h-4 w-4" /></button>
        </form>
        {searching && <p className="mt-2 text-sm text-ink/60">Searching…</p>}
        {found && !searching && (
          <div className="mt-3 max-h-72 space-y-2 overflow-auto text-sm">
            {found.length === 0 ? <p className="text-ink/60">No matches.</p> : found.slice(0, 50).map((a) => <button key={a.number} className="block w-full rounded-md border border-line p-2 text-left hover:bg-forest-50" onClick={() => { setMode('surah'); setN(a.surah!.number); setFound(null); }}><b>{a.surah!.englishName} {a.surah!.number}:{a.numberInSurah}</b> — {a.text}</button>)}
            {found.length > 50 && <p className="text-xs text-ink/55">Showing the first 50 of {found.length}.</p>}
          </div>
        )}
      </div>
      {mode === 'surah' && info && <h2 className="text-center font-heading text-xl text-forest-700">{info.englishName} <span className="font-normal text-ink/60">· {info.englishNameTranslation} · {info.numberOfAyahs} ayat · {info.revelationType}</span></h2>}
      <Status s={passage} what="the text" />
      {passage.data && (
        <ol className="space-y-3">
          {passage.data.arabic.map((a, i) => {
            const sn = a.surah?.number ?? n; const key = `${sn}:${a.numberInSurah}`; const marked = marks.includes(key);
            return (
              <li key={a.number} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <span className="rounded-full bg-forest-50 px-2 py-0.5 text-xs text-forest-700">{key}</span>
                  <button aria-label={marked ? 'Remove bookmark' : 'Bookmark'} onClick={() => toggle(key)} className="text-gold-500">{marked ? <BookmarkCheck className="h-5 w-5" /> : <Bookmark className="h-5 w-5" />}</button>
                </div>
                <p dir="rtl" lang="ar" className="mt-2 font-serif text-2xl leading-[2.2] text-ink">{a.text}</p>
                <p className="mt-2 text-sm text-ink/75">{passage.data!.english[i]?.text}</p>
              </li>
            );
          })}
        </ol>
      )}
      {marks.length > 0 && <div className={card}><b className="text-sm">Your bookmarks</b> <span className="text-xs text-ink/55">(saved on this device)</span><div className="mt-2 flex flex-wrap gap-2">{marks.map((m) => <button key={m} className={btn} onClick={() => { setMode('surah'); setN(+m.split(':')[0]); }}>{m}</button>)}</div></div>}
      <Attribution>Arabic text (Uthmani) and English translation (Saheeh International) are provided live by <a className="underline" href="https://alquran.cloud">AlQuran Cloud</a>. Verses are shown exactly as the provider supplies them.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Listen */
function Listen() {
  const reciters = useAsync(api.listReciters, []);
  const surahs = useAsync(api.listSurahs, []);
  const [rid, setRid] = useState<number | null>(null);
  const [mid, setMid] = useState<number | null>(null);
  const [surah, setSurah] = useState(1);
  const [repeat, setRepeat] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); const [dur, setDur] = useState(0); const [vol, setVol] = useState(1);
  const [err, setErr] = useState('');
  const au = useRef<HTMLAudioElement>(null);
  const [filter, setFilter] = useState('');
  const list = useMemo(() => (reciters.data ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase())), [reciters.data, filter]);
  const reciter: Reciter | undefined = reciters.data?.find((r) => r.id === rid) ?? reciters.data?.[0];
  const moshaf = reciter?.moshaf.find((m) => m.id === mid) ?? reciter?.moshaf[0];
  const avail = moshaf ? surahsAvailable(moshaf) : [];
  const cur = avail.includes(surah) ? surah : avail[0];
  const src = moshaf && cur ? audioUrl(moshaf, cur) : '';
  useEffect(() => { setErr(''); setPos(0); setDur(0); if (au.current && src && playing) void au.current.play().catch(() => setPlaying(false)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [src]);
  const step = useCallback((d: number) => { const i = avail.indexOf(cur!); const nx = avail[i + d]; if (nx) setSurah(nx); }, [avail, cur]);
  const toggle = () => { const a = au.current; if (!a || !src) return; if (a.paused) { void a.play().then(() => setPlaying(true)).catch(() => setErr('This recording could not be played.')); } else { a.pause(); setPlaying(false); } };
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="space-y-4">
      <Status s={reciters} what="the reciters" />
      {reciters.data && (
        <>
          <div className={card}>
            <p className="text-sm text-ink/70"><b>{reciters.data.length}</b> reciters available{reciters.data.length < 50 ? ' (the provider currently lists fewer than 50)' : ''}.</p>
            <input className={cn(sel, 'mt-2')} placeholder="Search reciters" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select aria-label="Reciter" className={cn(sel, 'mt-2')} value={reciter?.id} onChange={(e) => { setRid(+e.target.value); setMid(null); }}>
              {list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {reciter && reciter.moshaf.length > 1 && <select aria-label="Recitation" className={cn(sel, 'mt-2')} value={moshaf?.id} onChange={(e) => setMid(+e.target.value)}>{reciter.moshaf.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
            <select aria-label="Surah" className={cn(sel, 'mt-2')} value={cur} onChange={(e) => setSurah(+e.target.value)}>{avail.map((i) => <option key={i} value={i}>{i}. {surahs.data?.[i - 1]?.englishName ?? `Surah ${i}`}</option>)}</select>
          </div>
          <div className={card}>
            <audio ref={au} src={src || undefined} preload="none" loop={repeat}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
              onEnded={() => { if (!repeat) step(1); }} onError={() => { setPlaying(false); setErr('This recording is unavailable right now. Try another surah or reciter.'); }} />
            <p className="text-center font-medium text-forest-700">{surahs.data?.[(cur ?? 1) - 1]?.englishName} — {reciter?.name}</p>
            <input aria-label="Seek" type="range" className="mt-3 w-full" min={0} max={dur || 0} step={1} value={Math.min(pos, dur || 0)} onChange={(e) => { if (au.current) au.current.currentTime = +e.target.value; }} />
            <div className="flex justify-between text-xs text-ink/60"><span>{mmss(pos)}</span><span>{dur ? mmss(dur) : '--:--'}</span></div>
            <div className="mt-2 flex items-center justify-center gap-2">
              <button className={btn} aria-label="Previous surah" onClick={() => step(-1)} disabled={avail.indexOf(cur!) <= 0}><SkipBack className="h-4 w-4" /></button>
              <button className={cn(btn, 'bg-forest-700 px-5 text-white hover:bg-forest-700')} aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>{playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
              <button className={btn} aria-label="Next surah" onClick={() => step(1)} disabled={avail.indexOf(cur!) >= avail.length - 1}><SkipForward className="h-4 w-4" /></button>
              <button className={cn(btn, repeat && 'bg-gold-100')} aria-pressed={repeat} aria-label="Repeat" onClick={() => setRepeat(!repeat)}><Repeat className="h-4 w-4" /></button>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-ink/60"><Volume2 className="h-4 w-4" /><input aria-label="Volume" type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => { setVol(+e.target.value); if (au.current) au.current.volume = +e.target.value; }} className="w-full" /></label>
            {err && <p role="alert" className="mt-2 text-center text-sm text-red-700">{err}</p>}
          </div>
        </>
      )}
      <Attribution>Reciter catalogue and audio files are provided live by <a className="underline" href="https://mp3quran.net">MP3Quran.net</a>. Audio is streamed from their servers and is not stored by this site.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Prayer */
function Prayer() {
  const [placeId, setPlaceId] = store('ela.islamic.place', 'ilorin');
  const [method, setMethod] = store('ela.islamic.method', 3);
  const place = api.PLACES.find((p) => p.id === placeId) ?? api.PLACES[0];
  const day = useAsync(() => api.prayerTimes(place.lat, place.lon, method, new Date()), [place.id, method]);
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const nx = day.data ? nextPrayer(day.data.timings, minutesInZone(now, place.tz)) : null;
  return (
    <div className="space-y-4">
      <div className={card}>
        <select aria-label="Place" className={sel} value={place.id} onChange={(e) => setPlaceId(e.target.value)}>{api.PLACES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select aria-label="Calculation method" className={cn(sel, 'mt-2')} value={method} onChange={(e) => setMethod(+e.target.value)}>{api.METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
      </div>
      <Status s={day} what="prayer times" />
      {day.data && (
        <div className={card}>
          {nx && <p className="text-center text-lg text-forest-700">Next: <b>{nx.name}</b> in {fmtCountdown(nx.inMin)}{nx.tomorrow ? ' (tomorrow)' : ''}</p>}
          <p className="mb-2 text-center text-sm text-ink/60">{now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: place.tz })} · {day.data.hijri}</p>
          <ul className="divide-y divide-line">{[...PRAYERS.slice(0, 1), 'Sunrise', ...PRAYERS.slice(1)].map((p) => <li key={p} className={cn('flex justify-between py-2', nx?.name === p && 'font-semibold text-forest-700')}><span>{p}</span><span>{day.data!.timings[p]?.slice(0, 5)}</span></li>)}</ul>
        </div>
      )}
      <Attribution>Times are calculated by <a className="underline" href="https://aladhan.com">AlAdhan</a> ({day.data?.methodName || 'selected method'}) for {place.label}. Calculated times can differ by a few minutes from your local mosque; follow your local masjid timetable where it differs.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Hadith */
interface CmsItem { id: string; type: string; title: string; arabic?: string; body?: string; source?: string }
function useCms(type: string) {
  return useAsync(async () => {
    const snap = await getDocs(query(collection(db(), 'islamicContent'), where('status', '==', 'published'), where('type', '==', type)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CmsItem);
  }, [type]);
}
function Hadith() {
  const [i, setI] = useState(dailyIndex(new Date(), api.NAWAWI_COUNT));
  const h = useAsync(() => api.nawawiHadith(i + 1), [i]);
  const cms = useCms('hadith');
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><button className={btn} onClick={() => setI((i + api.NAWAWI_COUNT - 1) % api.NAWAWI_COUNT)}><ChevronLeft className="h-4 w-4" />Previous</button><button className={btn} onClick={() => setI(dailyIndex(new Date(), api.NAWAWI_COUNT))}>Today’s hadith</button><button className={btn} onClick={() => setI((i + 1) % api.NAWAWI_COUNT)}>Next<ChevronRight className="h-4 w-4" /></button></div>
      <Status s={h} what="the hadith" />
      {h.data && <article className={card}>
        {h.data.arabic && <p dir="rtl" lang="ar" className="font-serif text-xl leading-[2.1]">{h.data.arabic}</p>}
        <p className="mt-3 text-[15px] leading-relaxed">{h.data.english}</p>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink/65"><dt className="font-semibold">Collection</dt><dd>{h.data.collection}</dd><dt className="font-semibold">Reference</dt><dd>{h.data.reference}</dd><dt className="font-semibold">Grading</dt><dd>{h.data.grade}</dd></dl>
      </article>}
      {cms.data?.map((c) => <article key={c.id} className={card}><h3 className="font-medium text-forest-700">{c.title}</h3>{c.arabic && <p dir="rtl" lang="ar" className="mt-2 font-serif text-xl leading-[2.1]">{c.arabic}</p>}{c.body && <p className="mt-2 text-sm">{c.body}</p>}{c.source && <p className="mt-2 text-xs text-ink/60">Source: {c.source}</p>}</article>)}
      <Attribution>Hadith text from the open <a className="underline" href="https://github.com/fawazahmed0/hadith-api">hadith-api</a> dataset (Forty Hadith of an-Nawawi). Where the source gives no grading, none is shown. The school can add further verified hadith from the website admin area.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Adhkar */
function AdhkarCard({ a }: { a: Adhkar }) {
  const [count, setCount] = useState(0);
  const passage = useAsync(() => (a.quran ? api.ayahRange(a.quran.surah, a.quran.from, a.quran.to) : Promise.resolve(null)), [a.id]);
  const done = count >= a.times;
  return (
    <li className={cn(card, done && 'border-forest-500 bg-forest-50')}>
      {a.arabic && <p dir="rtl" lang="ar" className="font-serif text-2xl leading-[2.1]">{a.arabic}</p>}
      {a.quran && <>{passage.data?.arabic.map((x) => <p key={x.number} dir="rtl" lang="ar" className="font-serif text-2xl leading-[2.1]">{x.text}</p>)}{passage.loading && <p className="text-sm text-ink/55">Loading verse…</p>}{passage.error && <p className="text-sm text-red-700">Verse text unavailable — check your connection.</p>}</>}
      <p className="mt-2 text-sm text-ink/80">{a.english}</p>
      <p className="mt-1 text-xs text-ink/55">Source: {a.source}</p>
      <div className="mt-3 flex items-center gap-2">
        <button className={cn(btn, 'min-w-28 bg-forest-700 text-white hover:bg-forest-700')} onClick={() => setCount(Math.min(count + 1, a.times))} disabled={done}>{done ? 'Done ✓' : `Tap  ${count} / ${a.times}`}</button>
        <button className={btn} onClick={() => setCount(0)} aria-label="Reset counter"><RotateCcw className="h-4 w-4" /></button>
      </div>
    </li>
  );
}
function AdhkarTab() {
  const [g, setG] = useState<Adhkar['group']>('morning');
  const cms = useCms('adhkar');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{ADHKAR_GROUPS.map((x) => <button key={x.id} onClick={() => setG(x.id)} className={cn(btn, g === x.id && 'bg-forest-700 text-white hover:bg-forest-700')}>{x.label}</button>)}</div>
      <ol key={g} className="space-y-3">{ADHKAR.filter((a) => a.group === g).map((a) => <AdhkarCard key={a.id} a={a} />)}</ol>
      {cms.data?.map((c) => <article key={c.id} className={card}><h3 className="font-medium text-forest-700">{c.title}</h3>{c.arabic && <p dir="rtl" lang="ar" className="mt-2 font-serif text-xl leading-[2.1]">{c.arabic}</p>}{c.body && <p className="mt-2 text-sm">{c.body}</p>}{c.source && <p className="mt-2 text-xs text-ink/60">Source: {c.source}</p>}</article>)}
      <Attribution>Each remembrance shows its source and the number of repetitions reported there. Verses are fetched live from AlQuran Cloud. Please have the school’s teacher confirm any wording you plan to memorise.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Tajweed */
function Tajweed() {
  const cms = useCms('tajweed');
  return (
    <div className="space-y-4">
      {TAJWEED.map((l) => <section key={l.level} className={card}><h3 className="font-heading text-lg text-forest-700">{l.level}</h3><div className="mt-2 space-y-3">{l.lessons.map((x) => <details key={x.title} className="rounded-md border border-line p-3"><summary className="cursor-pointer font-medium">{x.title}</summary><p className="mt-2 text-sm leading-relaxed text-ink/80">{x.body}</p></details>)}</div></section>)}
      {cms.data && cms.data.length > 0 && <section className={card}><h3 className="font-heading text-lg text-forest-700">From our teachers</h3><div className="mt-2 space-y-3">{cms.data.map((x) => <details key={x.id} className="rounded-md border border-line p-3"><summary className="cursor-pointer font-medium">{x.title}</summary><p className="mt-2 whitespace-pre-line text-sm text-ink/80">{x.body}</p></details>)}</div></section>}
      <Attribution>This is an introductory outline. Tajweed is learned by listening and reciting to a qualified teacher — use these notes alongside classes.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Calendar */
function Calendar() {
  const [base, setBase] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const lead = (base.getDay() + 6) % 7;
  const today = new Date();
  const cells = Array.from({ length: lead + days }, (_, i) => (i < lead ? null : i - lead + 1));
  const h = (d: number) => hijriOf(new Date(Date.UTC(base.getFullYear(), base.getMonth(), d)));
  const first = h(1), last = h(days), t = hijriOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  return (
    <div className="space-y-4">
      <div className={card}>
        <p className="text-center text-sm text-ink/70">Today: {t ? `${t.day} ${t.monthName} ${t.year} AH` : 'Hijri date unavailable on this browser'}</p>
        <div className="mt-3 flex items-center justify-between"><button className={btn} aria-label="Previous month" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
          <div className="text-center"><b>{base.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</b><div className="text-xs text-ink/60">{first && last ? `${first.monthName} ${first.year}${last.month !== first.month ? ` – ${last.monthName} ${last.year}` : ''}` : ''}</div></div>
          <button className={btn} aria-label="Next month" onClick={() => setBase(new Date(base.getFullYear(), base.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></button></div>
        <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-1 font-semibold text-ink/55">{d}</div>)}
          {cells.map((d, i) => d === null ? <div key={i} /> : <div key={i} className={cn('rounded-md border border-line py-1', d === today.getDate() && base.getMonth() === today.getMonth() && base.getFullYear() === today.getFullYear() && 'border-gold-400 bg-gold-100')}><div className="text-sm font-medium">{d}</div><div className="text-[10px] text-ink/55">{h(d)?.day ?? ''}</div></div>)}</div>
      </div>
      <Attribution><b>Please note:</b> Hijri dates here follow the Umm al-Qura calendar computed by your browser. The start of a Hijri month (and Ramadan, Eid) is confirmed by moon-sighting, so the official date in Nigeria may differ by a day. Follow the announcement of your local authority.</Attribution>
    </div>
  );
}

/* ------------------------------------------------------------------ Page */
export function IslamicPage() {
  const [tab, setTab] = useState<Tab>('quran');
  useEffect(() => { document.title = 'Islamic Portal — Episteme Learning Academy'; }, []);
  return (
    <div className="bg-cream">
      <header className="bg-forest-700 py-10 text-center text-white"><p dir="rtl" lang="ar" className="font-serif text-2xl">بِسْمِ ٱللّٰهِ ٱلرَّحْمٰنِ ٱلرَّحِيمِ</p><h1 className="mt-2 font-heading text-3xl">Islamic Portal</h1><p className="mt-1 text-sm text-gold-300">Where Learning Meets Morality</p></header>
      <div className="mx-auto max-w-3xl px-4 pb-16">
        <nav aria-label="Islamic portal sections" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-cream/95 px-4 py-3 backdrop-blur">{TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={cn('whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium', tab === id ? 'border-forest-700 bg-forest-700 text-white' : 'border-line bg-white text-forest-700')}>{label}</button>)}</nav>
        <main className="mt-3">
          {tab === 'quran' && <Quran />}{tab === 'listen' && <Listen />}{tab === 'prayer' && <Prayer />}{tab === 'hadith' && <Hadith />}{tab === 'adhkar' && <AdhkarTab />}{tab === 'tajweed' && <Tajweed />}{tab === 'calendar' && <Calendar />}
        </main>
      </div>
    </div>
  );
}
