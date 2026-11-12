import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSearchParams } from 'react-router-dom';
import * as api from './api';
import { useCmsType } from './cms';
import { Dashboard, Khutbah, Videos } from './content';
import { Quran } from './reader';
import { AlarmsTab } from './alarms';
import { usePlayer } from './player';
import { ShareButton } from './share';
import { ADHKAR, ADHKAR_GROUPS, dailyIndex, fmtCountdown, hijriOf, minutesInZone, nextPrayer, PRAYERS, surahsAvailable, TAJWEED, type Adhkar, type Reciter } from './lib';

const TABS = [['home', 'Home'], ['quran', 'Qur’an'], ['listen', 'Listen'], ['khutbah', 'Khutbah'], ['videos', 'Videos'], ['prayer', 'Prayer times'], ['hadith', 'Hadith'], ['adhkar', 'Adhkar'], ['tajweed', 'Tajweed'], ['calendar', 'Calendar'], ['alarms', 'Reminders']] as const;
type Tab = (typeof TABS)[number][0];

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

/* ------------------------------------------------------------------ Listen */
function Listen({ initialSurah }: { initialSurah: number }) {
  const player = usePlayer();
  const reciters = useAsync(api.listReciters, []);
  const surahs = useAsync(api.listSurahs, []);
  const [rid, setRid] = store<number | null>('ela.islamic.reciter', null);
  const [mid, setMid] = useState<number | null>(null);
  const [surah, setSurah] = useState(initialSurah);
  const [filter, setFilter] = useState('');
  const list = useMemo(() => (reciters.data ?? []).filter((r) => r.name.toLowerCase().includes(filter.toLowerCase())), [reciters.data, filter]);
  const reciter: Reciter | undefined = reciters.data?.find((r) => r.id === rid) ?? reciters.data?.[0];
  const moshaf = reciter?.moshaf.find((m) => m.id === mid) ?? reciter?.moshaf[0];
  const avail = moshaf ? surahsAvailable(moshaf) : [];
  const cur = avail.includes(surah) ? surah : avail[0];
  return (
    <div className="space-y-4">
      <Status s={reciters} what="the reciters" />
      {reciters.data && (
        <div className={card}>
          <p className="text-sm text-ink/70"><b>{reciters.data.length}</b> reciters available{reciters.data.length < 50 ? ' (the provider currently lists fewer than 50)' : ''}.</p>
          <input className={cn(sel, 'mt-2')} placeholder="Search reciters" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <select aria-label="Reciter" className={cn(sel, 'mt-2')} value={reciter?.id} onChange={(e) => { setRid(+e.target.value); setMid(null); }}>{list.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          {reciter && reciter.moshaf.length > 1 && <select aria-label="Recitation" className={cn(sel, 'mt-2')} value={moshaf?.id} onChange={(e) => setMid(+e.target.value)}>{reciter.moshaf.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
          <select aria-label="Surah" className={cn(sel, 'mt-2')} value={cur} onChange={(e) => setSurah(+e.target.value)}>{avail.map((i) => <option key={i} value={i}>{i}. {surahs.data?.[i - 1]?.englishName ?? `Surah ${i}`}</option>)}</select>
          <button className={cn(btn, 'mt-3 w-full bg-forest-700 text-white hover:bg-forest-700')} disabled={!reciter || !moshaf || !cur} onClick={() => reciter && moshaf && cur && player.playQuran(reciter, moshaf, cur)}><Play className="h-4 w-4" />Play from this surah</button>
          <p className="mt-3 text-xs text-ink/60">When a surah ends, the next one plays automatically. Playback continues while you browse the site or use other apps, and the controls appear on your phone’s lock screen. Use the bar at the bottom to pause or skip.</p>
        </div>
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
function useCms(type: string) { const s = useCmsType(type); return { data: s.items }; }
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
        <div className="mt-3"><ShareButton text={`${h.data.english}\n— ${h.data.reference}`} path="/islamic?tab=hadith" /></div>
      </article>}
      {cms.data?.map((c) => <article key={c.id} className={card}><h3 className="font-medium text-forest-700">{c.title}</h3>{c.arabic && <p dir="rtl" lang="ar" className="mt-2 font-serif text-xl leading-[2.1]">{c.arabic}</p>}{c.body && <p className="mt-2 text-sm">{c.body}</p>}{c.source && <p className="mt-2 text-xs text-ink/60">Source: {c.source}</p>}<div className="mt-2"><ShareButton text={`${c.title}\n${c.arabic ?? ''}\n${c.body ?? ''}${c.source ? '\n— ' + c.source : ''}`} path="/islamic?tab=hadith" /></div></article>)}
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
        <ShareButton text={`${a.arabic ?? passage.data?.arabic.map((x) => x.text).join(' ') ?? ''}\n\n${a.english}\n— ${a.source}`} path="/islamic?tab=adhkar" />
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
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some(([id]) => id === asked) ? (asked as Tab) : 'home';
  const setTab = (t: Tab) => { setParams(t === 'home' ? {} : { tab: t }, { replace: false }); window.scrollTo(0, 0); };
  const [listenSurah, setListenSurah] = useState(1);
  useEffect(() => { document.title = 'Islamic Portal — Episteme Learning Academy'; }, []);
  useEffect(() => { const f = (e: Event) => { setListenSurah((e as CustomEvent<number>).detail || 1); setTab('listen'); }; document.addEventListener('ela-go-listen', f); return () => document.removeEventListener('ela-go-listen', f); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return (
    <div className="bg-cream">
      <header className="bg-forest-700 py-10 text-center text-white"><p dir="rtl" lang="ar" className="font-serif text-2xl">بِسْمِ ٱللّٰهِ ٱلرَّحْمٰنِ ٱلرَّحِيمِ</p><h1 className="mt-2 font-heading text-3xl">Islamic Portal</h1><p className="mt-1 text-sm text-gold-300">Where Learning Meets Morality</p></header>
      <div className="mx-auto max-w-3xl px-4 pb-32">
        <nav aria-label="Islamic portal sections" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-cream/95 px-4 py-3 backdrop-blur">{TABS.map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id} className={cn('whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium', tab === id ? 'border-forest-700 bg-forest-700 text-white' : 'border-line bg-white text-forest-700')}>{label}</button>)}</nav>
        <main className="mt-3">
          {tab === 'home' && <Dashboard go={(t) => setTab(t as Tab)} />}{tab === 'quran' && <Quran />}{tab === 'listen' && <Listen initialSurah={listenSurah} />}{tab === 'khutbah' && <Khutbah />}{tab === 'videos' && <Videos />}{tab === 'alarms' && <AlarmsTab />}{tab === 'prayer' && <Prayer />}{tab === 'hadith' && <Hadith />}{tab === 'adhkar' && <AdhkarTab />}{tab === 'tajweed' && <Tajweed />}{tab === 'calendar' && <Calendar />}
        </main>
      </div>
    </div>
  );
}
