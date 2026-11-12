/** Pure helpers for the /islamic portal (no network, fully unit-tested). */

export const pad3 = (n: number) => String(n).padStart(3, '0');

export interface Moshaf { id: number; name: string; server: string; surah_total: number; moshaf_type?: number; surah_list: string }
export interface Reciter { id: number; name: string; letter?: string; moshaf: Moshaf[] }

/** mp3quran.net publishes `server` as a folder URL; files are <server>/<001>.mp3 */
export function audioUrl(m: Pick<Moshaf, 'server'>, surah: number): string {
  return `${m.server.replace(/\/?$/, '/')}${pad3(surah)}.mp3`;
}
export function surahsAvailable(m: Pick<Moshaf, 'surah_list'>): number[] {
  return String(m.surah_list || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n >= 1 && n <= 114).sort((a, b) => a - b);
}
/** Keep only reciters that have at least one playable moshaf; returns clean copies. */
export function cleanReciters(raw: unknown): Reciter[] {
  const list = (raw as { reciters?: unknown[] } | null)?.reciters;
  if (!Array.isArray(list)) return [];
  const out: Reciter[] = [];
  for (const r of list as Array<Record<string, unknown>>) {
    const moshaf = (Array.isArray(r.moshaf) ? r.moshaf : []).filter((m: Record<string, unknown>) => typeof m?.server === 'string' && surahsAvailable({ surah_list: String(m.surah_list ?? '') }).length > 0) as unknown as Moshaf[];
    if (typeof r.name === 'string' && moshaf.length) out.push({ id: Number(r.id), name: r.name, letter: typeof r.letter === 'string' ? r.letter : undefined, moshaf });
  }
  return out;
}

export const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
export type PrayerName = (typeof PRAYERS)[number];
/** "05:12 (WAT)" → minutes since midnight, or null. */
export function toMinutes(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}
/** Next prayer after `nowMin`; wraps to tomorrow's Fajr. `inMin` = minutes until it starts. */
export function nextPrayer(timings: Record<string, string>, nowMin: number): { name: PrayerName; inMin: number; tomorrow: boolean } | null {
  const times = PRAYERS.map((p) => ({ name: p, at: toMinutes(timings[p]) })).filter((x): x is { name: PrayerName; at: number } => x.at !== null);
  if (!times.length) return null;
  const nx = times.find((t) => t.at > nowMin);
  if (nx) return { name: nx.name, inMin: nx.at - nowMin, tomorrow: false };
  return { name: times[0].name, inMin: times[0].at + 1440 - nowMin, tomorrow: true };
}
export function fmtCountdown(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
/** Minutes since midnight in Africa/Lagos (or any IANA zone). */
export function minutesInZone(d: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
  return (+(p.find((x) => x.type === 'hour')?.value ?? 0) % 24) * 60 + +(p.find((x) => x.type === 'minute')?.value ?? 0);
}

export const HIJRI_MONTHS = ['Muharram', 'Safar', "Rabi' al-awwal", "Rabi' al-thani", 'Jumada al-ula', 'Jumada al-akhirah', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal', "Dhu al-Qi'dah", 'Dhu al-Hijjah'];
/** Tabular/astronomical Umm al-Qura date from the browser's ICU data. May differ by a day from local moon-sighting. */
export function hijriOf(d: Date): { day: number; month: number; monthName: string; year: number } | null {
  try {
    const p = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).formatToParts(d);
    const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value ?? '', 10);
    const day = g('day'), month = g('month'), year = g('year');
    if (!day || !month || !year) return null;
    return { day, month, monthName: HIJRI_MONTHS[month - 1], year };
  } catch { return null; }
}
/** Day-of-year (1-366) for a UTC date — drives the "daily" rotation. */
export function dayOfYear(d: Date): number {
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86400000);
}
/** Rotate through `count` items so each calendar day shows the next one. */
export const dailyIndex = (d: Date, count: number) => (count > 0 ? (dayOfYear(d) - 1) % count : 0);

export interface Adhkar { id: string; group: 'morning' | 'evening' | 'after-prayer' | 'sleep' | 'waking'; arabic?: string; quran?: { surah: number; from: number; to: number }; english: string; times: number; source: string }
const MORNING_EVENING_QURAN: Adhkar[] = [
  { id: 'kursi', group: 'morning', quran: { surah: 2, from: 255, to: 255 }, english: 'Ayat al-Kursi.', times: 1, source: 'Qur’an 2:255; Hisn al-Muslim (an-Nasa’i, Amal al-Yawm wal-Laylah)' },
  { id: 'quls', group: 'morning', quran: { surah: 112, from: 1, to: 4 }, english: 'Surah al-Ikhlas — recited three times, then al-Falaq and an-Nas three times each.', times: 3, source: 'Abu Dawud 5082; at-Tirmidhi 3575' },
];
export const ADHKAR: Adhkar[] = [
  ...MORNING_EVENING_QURAN,
  { id: 'tasbih100', group: 'morning', arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', english: 'Glory be to Allah and praise be to Him.', times: 100, source: 'Sahih Muslim 2692' },
  { id: 'tahlil', group: 'morning', arabic: 'لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ وَهُوَ عَلَى كُلِّ شَيْءٍ قَدِيرٌ', english: 'None has the right to be worshipped but Allah alone, without partner; His is the dominion and His is the praise, and He is over all things capable.', times: 10, source: 'Hisn al-Muslim (Abu Dawud 5077); 100 times in a day: Sahih al-Bukhari 3293, Sahih Muslim 2691' },
  { id: 'kursi-e', group: 'evening', quran: { surah: 2, from: 255, to: 255 }, english: 'Ayat al-Kursi.', times: 1, source: 'Qur’an 2:255; Hisn al-Muslim' },
  { id: 'quls-e', group: 'evening', quran: { surah: 112, from: 1, to: 4 }, english: 'Surah al-Ikhlas — three times, then al-Falaq and an-Nas three times each.', times: 3, source: 'Abu Dawud 5082; at-Tirmidhi 3575' },
  { id: 'tasbih100-e', group: 'evening', arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ', english: 'Glory be to Allah and praise be to Him.', times: 100, source: 'Sahih Muslim 2692' },
  { id: 'istighfar', group: 'after-prayer', arabic: 'أَسْتَغْفِرُ اللَّهَ', english: 'I seek Allah’s forgiveness.', times: 3, source: 'Sahih Muslim 591' },
  { id: 'subhanallah', group: 'after-prayer', arabic: 'سُبْحَانَ اللَّهِ', english: 'Glory be to Allah.', times: 33, source: 'Sahih al-Bukhari 843; Sahih Muslim 595' },
  { id: 'alhamdulillah', group: 'after-prayer', arabic: 'الْحَمْدُ لِلَّهِ', english: 'All praise is for Allah.', times: 33, source: 'Sahih al-Bukhari 843; Sahih Muslim 595' },
  { id: 'allahuakbar', group: 'after-prayer', arabic: 'اللَّهُ أَكْبَرُ', english: 'Allah is the Greatest.', times: 33, source: 'Sahih al-Bukhari 843; Sahih Muslim 595 (completed to 100 with the tahlil)' },
  { id: 'kursi-s', group: 'sleep', quran: { surah: 2, from: 255, to: 255 }, english: 'Ayat al-Kursi before sleeping.', times: 1, source: 'Sahih al-Bukhari 2311' },
  { id: 'baqarah-end', group: 'sleep', quran: { surah: 2, from: 285, to: 286 }, english: 'The last two verses of Surah al-Baqarah.', times: 1, source: 'Sahih al-Bukhari 5009' },
  { id: 'quls-s', group: 'sleep', quran: { surah: 112, from: 1, to: 4 }, english: 'Al-Ikhlas, al-Falaq and an-Nas, recited into the cupped hands and wiped over the body, three times.', times: 3, source: 'Sahih al-Bukhari 5017' },
  { id: 'sleep-dua', group: 'sleep', arabic: 'بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا', english: 'In Your name, O Allah, I die and I live.', times: 1, source: 'Sahih al-Bukhari 6324' },
  { id: 'waking', group: 'waking', arabic: 'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', english: 'All praise is for Allah who gave us life after having taken it from us, and unto Him is the resurrection.', times: 1, source: 'Sahih al-Bukhari 6312' },
];
export const ADHKAR_GROUPS: Array<{ id: Adhkar['group']; label: string }> = [
  { id: 'morning', label: 'Morning' }, { id: 'evening', label: 'Evening' }, { id: 'after-prayer', label: 'After prayer' }, { id: 'sleep', label: 'Before sleep' }, { id: 'waking', label: 'On waking' },
];

export const TAJWEED: Array<{ level: string; lessons: Array<{ title: string; body: string }> }> = [
  { level: 'Level 1 — Foundations', lessons: [
    { title: 'Makharij al-huruf (points of articulation)', body: 'Every Arabic letter has a place it leaves from: the empty space of the mouth and throat (al-jawf), the throat (al-halq), the tongue (al-lisan), the lips (ash-shafatan) and the nasal passage (al-khayshum). Learning where each letter comes from is the first step to clear recitation.' },
    { title: 'Sifat al-huruf (characteristics of letters)', body: 'Letters also have qualities such as heaviness (isti’la’) and lightness (istifal), whispering (hams) and strength (jahr). These separate letters that sound alike.' },
    { title: 'Stopping and starting (waqf and ibtida’)', body: 'Learn where it is correct to pause for breath, and how to restart so the meaning is not changed.' },
  ] },
  { level: 'Level 2 — Noon and meem rules', lessons: [
    { title: 'Noon sakinah and tanween', body: 'Four rules apply: izhar (clear pronunciation) before throat letters; idgham (merging) before the letters of "yarmaloon"; iqlab (changing to a meem sound) before ba; and ikhfa’ (light concealment) before the remaining fifteen letters.' },
    { title: 'Meem sakinah', body: 'Three rules: ikhfa’ shafawi before ba; idgham shafawi before another meem; and izhar shafawi before all other letters.' },
    { title: 'Ghunnah', body: 'A nasal sound held for about two counts, strongest in a noon or meem with shaddah.' },
  ] },
  { level: 'Level 3 — Prolongation and special letters', lessons: [
    { title: 'Madd (prolongation)', body: 'The natural madd (madd tabi’i) is two counts. Longer madd occurs when a hamzah or a sukoon follows the madd letter (connected, separated, necessary and others).' },
    { title: 'Qalqalah', body: 'A slight echo on the letters qaf, ta, ba, jim and dal when they carry sukoon.' },
    { title: 'Lam and ra', body: 'The lam in the name Allah is heavy after fathah or dammah and light after kasrah. The ra is heavy or light depending on its vowel and the letters around it.' },
  ] },
];

/* ------------------------------------------------------------------ v2 additions */
/** Extract a YouTube video id from watch, youtu.be, shorts or embed links. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url || '');
  return m ? m[1] : null;
}
/** A different verse for each calendar day (1–6236), repeatable for the same date. */
export function ayahOfDay(d: Date): number {
  return (((dayOfYear(d) - 1) + (d.getUTCFullYear() - 2000) * 366) % 6236) + 1;
}
/**
 * Quran.com tajweed text contains <tajweed class=…>…</tajweed> markup. Keep only that
 * tag (class limited to [a-z_]) and the end-of-ayah span; escape everything else.
 */
export function sanitizeTajweed(html: string): string {
  const esc = (s: string) => s.replace(/&(?!(?:amp|lt|gt|quot|#\d+);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  let last = 0;
  const re = /<\/?(tajweed|span)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    out += esc(html.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = m[0][1] === '/';
    const tag = m[1].toLowerCase();
    if (closing) { out += `</${tag === 'tajweed' ? 'span' : 'span'}>`; continue; }
    const cls = /class\s*=\s*"?([a-z_ ]+)"?/i.exec(m[2])?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
    out += `<span class="${tag === 'tajweed' ? 'tj-' + cls.split(' ')[0] : 'tj-end'}">`;
  }
  return out + esc(html.slice(last));
}

export function shareLinks(url: string, text: string) {
  const u = encodeURIComponent(url), t = encodeURIComponent(text);
  return [
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
    { id: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${u}&text=${t}` },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { id: 'x', label: 'X', href: `https://twitter.com/intent/tweet?text=${t}&url=${u}` },
    { id: 'email', label: 'Email', href: `mailto:?subject=${t}&body=${u}` },
  ];
}

/* ---- alarms ---- */
export interface AlarmSettings {
  prayers: Record<PrayerName, { on: boolean; before: number }>;
  quran: { on: boolean; time: string };
  hadith: { on: boolean; time: string };
  dua: { on: boolean; time: string };
  blog: { on: boolean };
  sound: boolean;
}
export const DEFAULT_ALARMS: AlarmSettings = {
  prayers: { Fajr: { on: false, before: 0 }, Dhuhr: { on: false, before: 0 }, Asr: { on: false, before: 0 }, Maghrib: { on: false, before: 0 }, Isha: { on: false, before: 0 } },
  quran: { on: false, time: '05:30' }, hadith: { on: false, time: '07:00' }, dua: { on: false, time: '06:00' }, blog: { on: false }, sound: true,
};
export interface DueAlarm { id: string; title: string; body: string; url: string }
/**
 * Alarms due right now. An alarm is due from its minute until 2 minutes after (so a throttled
 * background tab still catches it); `fired` holds ids already shown for this dateKey.
 */
export function dueAlarms(s: AlarmSettings, timings: Record<string, string> | null, nowMin: number, dateKey: string, fired: string[]): DueAlarm[] {
  const out: DueAlarm[] = [];
  const hit = (target: number | null) => target !== null && nowMin >= target && nowMin <= target + 2;
  const add = (id: string, title: string, body: string, url: string) => { const k = `${dateKey}:${id}`; if (!fired.includes(k)) out.push({ id: k, title, body, url }); };
  if (timings) for (const p of PRAYERS) {
    const c = s.prayers[p]; if (!c?.on) continue;
    const at = toMinutes(timings[p]); if (at === null) continue;
    if (hit(at - Math.max(0, c.before))) add(`prayer-${p}`, c.before ? `${p} in ${c.before} minutes` : `Time for ${p}`, `${p} prayer ${c.before ? 'starts at ' + timings[p].slice(0, 5) : 'has begun'}.`, '/islamic?tab=prayer');
  }
  if (s.quran.on && hit(toMinutes(s.quran.time))) add('quran', 'Time to recite Qur’an', 'Open the Islamic portal to read or listen.', '/islamic?tab=quran');
  if (s.hadith.on && hit(toMinutes(s.hadith.time))) add('hadith', 'Hadith of the day', 'Today’s hadith is ready.', '/islamic?tab=hadith');
  if (s.dua.on && hit(toMinutes(s.dua.time))) add('dua', 'Daily dua and adhkar', 'Take a moment for your remembrance.', '/islamic?tab=adhkar');
  return out;
}
/** Posts published after `lastSeenMs` (oldest-first not needed). */
export function newPosts<T extends { publishedMs: number }>(posts: T[], lastSeenMs: number): T[] {
  return posts.filter((p) => p.publishedMs > lastSeenMs);
}
