/**
 * Provider adapters for the public /islamic portal. Everything is fetched live from the
 * provider and cached in memory; nothing is stored in or invented by this app.
 *  - Qur'an text:   AlQuran Cloud  https://api.alquran.cloud/v1   (Uthmani Arabic + Saheeh International)
 *  - Recitations:   MP3Quran       https://mp3quran.net/api/v3    (reciter catalogue + audio files)
 *  - Prayer times:  AlAdhan        https://api.aladhan.com/v1
 *  - Daily Hadith:  fawazahmed0 hadith-api via jsDelivr (Nawawi's Forty)
 */
import { cleanReciters, type Reciter } from './lib';

const QURAN = 'https://api.alquran.cloud/v1';
const MP3 = 'https://mp3quran.net/api/v3';
const ALADHAN = 'https://api.aladhan.com/v1';
const HADITH = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';

const cache = new Map<string, Promise<unknown>>();
async function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    const p = fetch(url).then(async (r) => { if (!r.ok) throw new Error(`Provider returned ${r.status}`); return r.json(); });
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url) as Promise<T>;
}

export interface SurahInfo { number: number; name: string; englishName: string; englishNameTranslation: string; numberOfAyahs: number; revelationType: string }
export interface Ayah { number: number; numberInSurah: number; text: string; juz: number; page: number; surah?: { number: number; englishName: string } }

export async function listSurahs(): Promise<SurahInfo[]> {
  const j = await getJson<{ data: SurahInfo[] }>(`${QURAN}/surah`);
  if (!Array.isArray(j.data) || j.data.length !== 114) throw new Error('Unexpected surah list from provider');
  return j.data;
}
export interface Passage { arabic: Ayah[]; english: Ayah[] }
const pair = (d: Array<{ ayahs: Ayah[] }>): Passage => ({ arabic: d[0].ayahs, english: d[1].ayahs });
export async function surahText(n: number): Promise<Passage> {
  const j = await getJson<{ data: Array<{ ayahs: Ayah[] }> }>(`${QURAN}/surah/${n}/editions/quran-uthmani,en.sahih`);
  return pair(j.data);
}
export async function juzText(n: number): Promise<Passage> {
  const j = await getJson<{ data: Array<{ ayahs: Ayah[] }> }>(`${QURAN}/juz/${n}/editions/quran-uthmani,en.sahih`);
  return pair(j.data);
}

/* ---- reader with scripts and units (surah / juz / Madani mushaf page) ---- */
export type Script = 'uthmani' | 'simple' | 'tajweed' | 'indopak';
export type Unit = 'surah' | 'juz' | 'page';
export const SCRIPTS: Array<{ id: Script; label: string; provider: string }> = [
  { id: 'uthmani', label: 'Uthmani', provider: 'AlQuran Cloud' }, { id: 'simple', label: 'Simple (Imla\u2019i)', provider: 'AlQuran Cloud' },
  { id: 'tajweed', label: 'Tajweed (colour-coded)', provider: 'Quran.com' }, { id: 'indopak', label: 'Indo-Pak', provider: 'Quran.com' },
];
export interface Row { key: string; surah: number; ayah: number; arabic: string; html: boolean; english: string; page?: number }
const QCOM = 'https://api.quran.com/api/v4/quran/verses';
const UNIT_Q: Record<Unit, string> = { surah: 'chapter_number', juz: 'juz_number', page: 'page_number' };
const keyOf = (surah: number, ayah: number) => `${surah}:${ayah}`;

export async function readerRows(unit: Unit, n: number, script: Script): Promise<Row[]> {
  const ed = script === 'simple' ? 'quran-simple' : 'quran-uthmani';
  const j = await getJson<{ data: Array<{ ayahs: Array<Ayah & { surah?: { number: number } }> }> }>(`${QURAN}/${unit === 'page' ? 'page' : unit}/${n}/editions/${ed},en.sahih`);
  const [ar, en] = j.data;
  const eng = new Map(en.ayahs.map((a) => [keyOf(a.surah?.number ?? n, a.numberInSurah), a.text]));
  let alt: Map<string, string> | null = null;
  if (script === 'tajweed' || script === 'indopak') {
    const q = await getJson<{ verses?: Array<{ verse_key: string; text_uthmani_tajweed?: string; text_indopak?: string; text_indopak_nastaleeq?: string }> }>(`${QCOM}/${script === 'tajweed' ? 'uthmani_tajweed' : 'indopak'}?${UNIT_Q[unit]}=${n}`);
    alt = new Map((q.verses ?? []).map((v) => [v.verse_key, (script === 'tajweed' ? v.text_uthmani_tajweed : v.text_indopak ?? v.text_indopak_nastaleeq) ?? '']));
  }
  return ar.ayahs.map((a) => {
    const surah = a.surah?.number ?? n, k = keyOf(surah, a.numberInSurah);
    const t = alt?.get(k);
    return { key: k, surah, ayah: a.numberInSurah, arabic: t || a.text, html: script === 'tajweed' && !!t, english: eng.get(k) ?? '', page: a.page };
  });
}
export async function ayahByNumber(n: number): Promise<{ arabic: string; english: string; surahName: string; surah: number; ayah: number }> {
  const j = await getJson<{ data: Array<{ text: string; numberInSurah: number; surah: { number: number; englishName: string } }> }>(`${QURAN}/ayah/${n}/editions/quran-uthmani,en.sahih`);
  const [a, e] = j.data;
  return { arabic: a.text, english: e.text, surahName: a.surah.englishName, surah: a.surah.number, ayah: a.numberInSurah };
}
export async function ayahRange(surah: number, from: number, to: number): Promise<Passage> {
  const p = await surahText(surah);
  const f = (a: Ayah) => a.numberInSurah >= from && a.numberInSurah <= to;
  return { arabic: p.arabic.filter(f), english: p.english.filter(f) };
}
/** Search the English translation (Saheeh International). */
export async function searchEnglish(q: string): Promise<Ayah[]> {
  const j = await getJson<{ data?: { matches?: Array<Ayah & { surah: { number: number; englishName: string } }> } }>(`${QURAN}/search/${encodeURIComponent(q)}/all/en.sahih`);
  return j.data?.matches ?? [];
}

export async function listReciters(): Promise<Reciter[]> {
  return cleanReciters(await getJson(`${MP3}/reciters?language=eng`));
}

export interface PrayerDay { timings: Record<string, string>; hijri: string; methodName: string }
export const METHODS: Array<{ id: number; label: string }> = [
  { id: 3, label: 'Muslim World League' }, { id: 2, label: 'ISNA (North America)' }, { id: 5, label: 'Egyptian General Authority' },
  { id: 4, label: 'Umm al-Qura, Makkah' }, { id: 1, label: 'University of Islamic Sciences, Karachi' }, { id: 7, label: 'Tehran' },
];
export const PLACES: Array<{ id: string; label: string; lat: number; lon: number; tz: string }> = [
  { id: 'ilorin', label: 'Ilorin, Nigeria', lat: 8.4966, lon: 4.5421, tz: 'Africa/Lagos' },
  { id: 'lagos', label: 'Lagos, Nigeria', lat: 6.5244, lon: 3.3792, tz: 'Africa/Lagos' },
  { id: 'abuja', label: 'Abuja, Nigeria', lat: 9.0765, lon: 7.3986, tz: 'Africa/Lagos' },
  { id: 'kano', label: 'Kano, Nigeria', lat: 12.0022, lon: 8.5920, tz: 'Africa/Lagos' },
  { id: 'makkah', label: 'Makkah, Saudi Arabia', lat: 21.3891, lon: 39.8579, tz: 'Asia/Riyadh' },
  { id: 'madinah', label: 'Madinah, Saudi Arabia', lat: 24.5247, lon: 39.5692, tz: 'Asia/Riyadh' },
];
export async function prayerTimes(lat: number, lon: number, method: number, date: Date): Promise<PrayerDay> {
  const dd = `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;
  const j = await getJson<{ data: { timings: Record<string, string>; date: { hijri: { day: string; month: { en: string }; year: string } }; meta?: { method?: { name?: string } } } }>(`${ALADHAN}/timings/${dd}?latitude=${lat}&longitude=${lon}&method=${method}`);
  const h = j.data.date.hijri;
  return { timings: j.data.timings, hijri: `${h.day} ${h.month.en} ${h.year} AH`, methodName: j.data.meta?.method?.name ?? '' };
}

export interface HadithItem { number: number; arabic: string; english: string; grade: string; reference: string; collection: string }
/** Nawawi's Forty are numbered 1–42; the `hadiths[0]` entry of each file holds the text. Parsed defensively. */
export async function nawawiHadith(n: number): Promise<HadithItem> {
  const pick = async (ed: string) => {
    const j = await getJson<{ hadiths?: Array<{ text?: string; grades?: Array<{ name?: string; grade?: string }>; reference?: { book?: number; hadith?: number } }> }>(`${HADITH}/${ed}/${n}.json`);
    const h = j.hadiths?.[0];
    if (!h?.text) throw new Error('Hadith not available from provider');
    return h;
  };
  const [en, ar] = await Promise.all([pick('eng-nawawi'), pick('ara-nawawi').catch(() => null)]);
  const g = en.grades?.find((x) => x.grade)?.grade;
  return { number: n, english: en.text!, arabic: ar?.text ?? '', grade: g || 'Grading is not stated in this source', reference: `Forty Hadith of an-Nawawi, no. ${n}`, collection: 'Forty Hadith of an-Nawawi' };
}
export const NAWAWI_COUNT = 42;
