import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, Repeat, SkipBack, SkipForward, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { listSurahs } from './api';
import { audioUrl, surahsAvailable, type Moshaf, type Reciter } from './lib';

/**
 * One <audio> element for the whole site. It lives above the router, so recitation keeps
 * playing while people browse other pages, and the Media Session API puts play/pause/next
 * on the phone lock screen and notification shade so other apps can be used meanwhile.
 */
export interface Track { title: string; subtitle?: string; src: string; kind: 'quran' | 'other'; reciter?: Reciter; moshaf?: Moshaf; surah?: number }
interface Ctx {
  track: Track | null; playing: boolean; pos: number; dur: number; repeat: boolean; volume: number; error: string;
  playQuran: (reciter: Reciter, moshaf: Moshaf, surah: number) => void; playUrl: (t: Omit<Track, 'kind'>) => void;
  toggle: () => void; next: () => void; prev: () => void; seek: (s: number) => void; setRepeat: (v: boolean) => void; setVolume: (v: number) => void; stop: () => void;
  hasNext: boolean; hasPrev: boolean;
}
const PlayerCtx = createContext<Ctx | null>(null);
export const usePlayer = () => { const c = useContext(PlayerCtx); if (!c) throw new Error('PlayerProvider missing'); return c; };

export function PlayerProvider({ children }: { children: ReactNode }) {
  const au = useRef<HTMLAudioElement>(null);
  const [track, setTrack] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); const [dur, setDur] = useState(0);
  const [repeat, setRepeat] = useState(false); const [volume, setVol] = useState(1); const [error, setError] = useState('');
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => { listSurahs().then((l) => setNames(l.map((s) => s.englishName))).catch(() => undefined); }, []);

  const list = useMemo(() => (track?.moshaf ? surahsAvailable(track.moshaf) : []), [track]);
  const idx = track?.surah ? list.indexOf(track.surah) : -1;
  const hasNext = idx >= 0 && idx < list.length - 1, hasPrev = idx > 0;

  const start = useCallback((t: Track) => {
    setError(''); setPos(0); setDur(0); setTrack(t);
    const a = au.current; if (!a) return;
    a.src = t.src; a.load();
    void a.play().then(() => setPlaying(true)).catch(() => { setPlaying(false); setError('Tap play to start the recitation.'); });
  }, []);
  const quranTrack = useCallback((reciter: Reciter, moshaf: Moshaf, surah: number): Track => ({ kind: 'quran', title: `${names[surah - 1] ?? 'Surah ' + surah}`, subtitle: reciter.name, src: audioUrl(moshaf, surah), reciter, moshaf, surah }), [names]);
  const playQuran = useCallback((r: Reciter, m: Moshaf, s: number) => start(quranTrack(r, m, s)), [start, quranTrack]);
  const playUrl = useCallback((t: Omit<Track, 'kind'>) => start({ ...t, kind: 'other' }), [start]);
  const step = useCallback((d: number) => {
    if (!track?.reciter || !track.moshaf || idx < 0) return;
    const n = list[idx + d]; if (n) start(quranTrack(track.reciter, track.moshaf, n));
  }, [track, idx, list, start, quranTrack]);
  const toggle = useCallback(() => { const a = au.current; if (!a || !track) return; if (a.paused) void a.play().then(() => setPlaying(true)).catch(() => setError('This audio could not be played.')); else { a.pause(); setPlaying(false); } }, [track]);
  const stop = useCallback(() => { const a = au.current; if (a) { a.pause(); a.removeAttribute('src'); a.load(); } setTrack(null); setPlaying(false); setPos(0); setDur(0); }, []);
  const seek = useCallback((s: number) => { if (au.current) au.current.currentTime = s; }, []);
  const setVolume = useCallback((v: number) => { setVol(v); if (au.current) au.current.volume = v; }, []);

  // Lock-screen / notification-shade controls so the recitation can run while using other apps.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: track.title, artist: track.subtitle ?? 'Episteme Learning Academy', album: 'Islamic Portal' });
      ms.setActionHandler('play', () => toggle()); ms.setActionHandler('pause', () => toggle());
      ms.setActionHandler('nexttrack', hasNext ? () => step(1) : null); ms.setActionHandler('previoustrack', hasPrev ? () => step(-1) : null);
      ms.setActionHandler('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime); });
    } catch { /* unsupported action on this browser */ }
  }, [track, hasNext, hasPrev, step, toggle, seek]);
  useEffect(() => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = track ? (playing ? 'playing' : 'paused') : 'none'; }, [playing, track]);

  const value: Ctx = { track, playing, pos, dur, repeat, volume, error, playQuran, playUrl, toggle, next: () => step(1), prev: () => step(-1), seek, setRepeat, setVolume, stop, hasNext, hasPrev };
  return (
    <PlayerCtx.Provider value={value}>
      {children}
      <audio ref={au} preload="none" loop={repeat}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
        // when a surah finishes, the next surah in the reciter's list starts by itself
        onEnded={() => { if (!repeat) { if (hasNext) step(1); else setPlaying(false); } }}
        onError={() => { setPlaying(false); if (track) setError('This recording is unavailable right now. Try another surah or reciter.'); }} />
      <MiniPlayer />
    </PlayerCtx.Provider>
  );
}

const mmss = (s: number) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '--:--');
const ib = 'inline-flex h-9 w-9 items-center justify-center rounded-full text-forest-700 hover:bg-forest-50 disabled:opacity-30';
/** Bar fixed to the bottom of every page while something is loaded. */
function MiniPlayer() {
  const p = usePlayer();
  if (!p.track) return null;
  return (
    <div role="region" aria-label="Audio player" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-white/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-pop backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-forest-700">{p.track.title}</p><p className="truncate text-xs text-ink/60">{p.error || p.track.subtitle}</p></div>
        <button className={ib} aria-label="Previous" disabled={!p.hasPrev} onClick={p.prev}><SkipBack className="h-4 w-4" /></button>
        <button className={cn(ib, 'bg-forest-700 text-white hover:bg-forest-700')} aria-label={p.playing ? 'Pause' : 'Play'} onClick={p.toggle}>{p.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <button className={ib} aria-label="Next" disabled={!p.hasNext} onClick={p.next}><SkipForward className="h-4 w-4" /></button>
        <button className={cn(ib, p.repeat && 'bg-gold-100')} aria-pressed={p.repeat} aria-label="Repeat" onClick={() => p.setRepeat(!p.repeat)}><Repeat className="h-4 w-4" /></button>
        <button className={ib} aria-label="Close player" onClick={p.stop}><X className="h-4 w-4" /></button>
      </div>
      <div className="mx-auto mt-1 flex max-w-3xl items-center gap-2 text-[11px] text-ink/60">
        <span>{mmss(p.pos)}</span><input aria-label="Seek" type="range" className="w-full" min={0} max={p.dur || 0} step={1} value={Math.min(p.pos, p.dur || 0)} onChange={(e) => p.seek(+e.target.value)} /><span>{mmss(p.dur)}</span>
      </div>
    </div>
  );
}
