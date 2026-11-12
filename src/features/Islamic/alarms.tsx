import { useEffect, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import { db } from '@/config/firebase';
import { toDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import * as api from './api';
import { DEFAULT_ALARMS, dueAlarms, minutesInZone, newPosts, PRAYERS, type AlarmSettings, type DueAlarm } from './lib';

const KEY = 'ela.islamic.alarms';
const SEEN = 'ela.islamic.lastPost';
const FIRED = 'ela.islamic.fired';
export function loadAlarms(): AlarmSettings {
  try { const r = JSON.parse(localStorage.getItem(KEY) || 'null'); return r ? { ...DEFAULT_ALARMS, ...r, prayers: { ...DEFAULT_ALARMS.prayers, ...r.prayers } } : DEFAULT_ALARMS; } catch { return DEFAULT_ALARMS; }
}
function saveAlarms(s: AlarmSettings) { try { localStorage.setItem(KEY, JSON.stringify(s)); window.dispatchEvent(new Event('ela-alarms')); } catch { /* storage blocked */ } }
const anyOn = (s: AlarmSettings) => PRAYERS.some((p) => s.prayers[p].on) || s.quran.on || s.hadith.on || s.dua.on || s.blog.on;
function beep() {
  try {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const c = new C(); const o = c.createOscillator(); const g = c.createGain();
    o.frequency.value = 660; g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.2);
    o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 1.3);
  } catch { /* audio blocked until the visitor interacts */ }
}

/** Mounted once at the app root: checks the clock every 20 s while the site is open (any page, or the installed app). */
export function AlarmEngine() {
  const [shown, setShown] = useState<DueAlarm[]>([]);
  const timings = useRef<{ day: string; t: Record<string, string> } | null>(null);
  const settings = useRef(loadAlarms());
  useEffect(() => { const f = () => { settings.current = loadAlarms(); }; window.addEventListener('ela-alarms', f); return () => window.removeEventListener('ela-alarms', f); }, []);

  useEffect(() => {
    const tick = async () => {
      const s = settings.current; if (!anyOn(s)) return;
      const now = new Date();
      const dateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now);
      if (PRAYERS.some((p) => s.prayers[p].on) && timings.current?.day !== dateKey) {
        try {
          const place = api.PLACES.find((p) => p.id === (JSON.parse(localStorage.getItem('ela.islamic.place') || '"ilorin"') as string)) ?? api.PLACES[0];
          const method = Number(JSON.parse(localStorage.getItem('ela.islamic.method') || '3'));
          timings.current = { day: dateKey, t: (await api.prayerTimes(place.lat, place.lon, method, now)).timings };
        } catch { /* try again next tick */ }
      }
      let fired: string[] = []; try { fired = JSON.parse(localStorage.getItem(FIRED) || '[]'); } catch { /* */ }
      fired = fired.filter((k) => k.startsWith(dateKey));
      const due = dueAlarms(s, timings.current?.t ?? null, minutesInZone(now, 'Africa/Lagos'), dateKey, fired);
      if (!due.length) return;
      try { localStorage.setItem(FIRED, JSON.stringify([...fired, ...due.map((d) => d.id)])); } catch { /* */ }
      notify(due, s.sound); setShown((x) => [...x, ...due]);
    };
    const blog = async () => {
      const s = settings.current; if (!s.blog.on) return;
      try {
        const snap = await getDocs(query(collection(db(), 'posts'), where('status', '==', 'published')));
        const posts = snap.docs.map((d) => ({ id: d.id, title: String(d.data().title ?? 'New post'), slug: String(d.data().slug ?? d.id), publishedMs: toDate(d.data().publishedAt)?.getTime() ?? 0 }));
        const last = Number(localStorage.getItem(SEEN) || 0);
        const newest = Math.max(0, ...posts.map((p) => p.publishedMs));
        if (last && newest > last) { const fresh = newPosts<(typeof posts)[number]>(posts, last); const due = fresh.map((p) => ({ id: `blog:${p.id}`, title: 'New blog post', body: p.title, url: `/blog/${p.slug}` })); notify(due, s.sound); setShown((x) => [...x, ...due]); }
        if (newest) localStorage.setItem(SEEN, String(newest));
      } catch { /* offline */ }
    };
    void tick(); void blog();
    const a = setInterval(() => void tick(), 20000), b = setInterval(() => void blog(), 300000);
    const vis = () => { if (document.visibilityState === 'visible') { void tick(); } };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(a); clearInterval(b); document.removeEventListener('visibilitychange', vis); };
  }, []);

  if (!shown.length) return null;
  return (
    <div className="fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-sm flex-col gap-2 px-3" role="alert">
      {shown.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-xl border border-gold-400 bg-white p-3 shadow-pop">
          <Bell className="mt-0.5 h-5 w-5 shrink-0 text-gold-500" />
          <div className="min-w-0 flex-1"><p className="font-semibold text-forest-700">{a.title}</p><p className="text-sm text-ink/70">{a.body}</p><Link to={a.url} onClick={() => setShown((x) => x.filter((y) => y.id !== a.id))} className="mt-1 inline-block text-sm font-medium text-forest-500 underline">Open</Link></div>
          <button aria-label="Dismiss" onClick={() => setShown((x) => x.filter((y) => y.id !== a.id))}><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
function notify(list: DueAlarm[], sound: boolean) {
  if (sound) beep();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    for (const a of list) { try { const n = new Notification(a.title, { body: a.body, tag: a.id, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` }); n.onclick = () => { window.focus(); n.close(); }; } catch { /* */ } }
  }
}

/* ------------------------------------------------------------------ settings UI */
const box = 'rounded-xl border border-line bg-white p-4 shadow-sm';
const timeInput = 'rounded-md border border-line bg-white px-2 py-1.5 text-sm';
export function AlarmsTab() {
  const [s, setS] = useState(loadAlarms());
  const [perm, setPerm] = useState<string>(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
  const update = (n: AlarmSettings) => { setS(n); saveAlarms(n); };
  const ask = async () => { if (typeof Notification !== 'undefined') setPerm(await Notification.requestPermission()); };
  const Row = ({ label, on, set, children }: { label: string; on: boolean; set: (v: boolean) => void; children?: React.ReactNode }) => (
    <label className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-0">
      <span className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[#0B3D2E]" checked={on} onChange={(e) => set(e.target.checked)} /><span className="font-medium">{label}</span></span>{children}
    </label>
  );
  return (
    <div className="space-y-4">
      <div className={box}>
        <p className="text-sm">Set reminders for prayer times, Qur’an recitation, the daily hadith, the daily dua and new blog posts. They are saved on this device only — no account needed.</p>
        {perm !== 'granted' && <button className="mt-3 rounded-md bg-forest-700 px-4 py-2 text-sm font-medium text-white" onClick={() => void ask()} disabled={perm === 'unsupported' || perm === 'denied'}>{perm === 'denied' ? 'Notifications are blocked in your browser settings' : perm === 'unsupported' ? 'This browser cannot show notifications' : 'Allow notifications'}</button>}
        {perm === 'granted' && <p className="mt-2 text-sm text-forest-700">Notifications are allowed.</p>}
        <p className="mt-3 rounded-md bg-gold-100 p-3 text-xs text-ink/80"><b>Important:</b> reminders ring while the website (or the installed app) is open on your phone or computer, including in the background. A website cannot wake a fully closed browser, so for the Adhan keep the site open or installed, or also use your phone’s own alarm.</p>
      </div>
      <div className={box}>
        <h3 className="font-heading text-lg text-forest-700">Prayer times</h3>
        {PRAYERS.map((p) => (
          <Row key={p} label={p} on={s.prayers[p].on} set={(v) => update({ ...s, prayers: { ...s.prayers, [p]: { ...s.prayers[p], on: v } } })}>
            <select aria-label={`${p} reminder lead time`} className={timeInput} value={s.prayers[p].before} onChange={(e) => update({ ...s, prayers: { ...s.prayers, [p]: { ...s.prayers[p], before: +e.target.value } } })}>
              <option value={0}>At prayer time</option><option value={5}>5 min before</option><option value={10}>10 min before</option><option value={15}>15 min before</option><option value={30}>30 min before</option>
            </select>
          </Row>
        ))}
        <p className="mt-2 text-xs text-ink/55">Uses the place and method chosen in the Prayer times tab.</p>
      </div>
      <div className={box}>
        <h3 className="font-heading text-lg text-forest-700">Daily reminders</h3>
        {([['quran', 'Qur’an recitation'], ['hadith', 'Hadith of the day'], ['dua', 'Daily dua / adhkar']] as const).map(([k, label]) => (
          <Row key={k} label={label} on={s[k].on} set={(v) => update({ ...s, [k]: { ...s[k], on: v } })}>
            <input type="time" aria-label={`${label} time`} className={timeInput} value={s[k].time} onChange={(e) => update({ ...s, [k]: { ...s[k], time: e.target.value } })} />
          </Row>
        ))}
        <Row label="New blog post" on={s.blog.on} set={(v) => update({ ...s, blog: { on: v } })} />
        <Row label="Play a sound" on={s.sound} set={(v) => update({ ...s, sound: v })} />
        <button className={cn('mt-3 rounded-md border border-line px-3 py-2 text-sm text-forest-700 hover:bg-forest-50')} onClick={() => { beep(); if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification('Test reminder', { body: 'Reminders are working.' }); }}>Send a test reminder</button>
      </div>
    </div>
  );
}
