import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { ArrowRight, ChevronDown, ChevronUp, FileText, Image as ImageIcon, Play, X } from 'lucide-react';
import { db } from '@/config/firebase';
import { sanitizeHtml, stripHtml } from '@/lib/sanitize';
import { cardImage, categoriesInUse, categoryLabel, categoryOf, homepagePosts, parseVideoUrl, stepIndex, swipeDir, visiblePosts, type SpotlightPost } from '@/lib/spotlight';
import { toDate } from '@/lib/utils';
import { ShareButton } from '@/features/Islamic/share';

/* ---------------------------------------------------------------- data (one cached read) */
let cache: { at: number; p: Promise<SpotlightPost[]> } | null = null;
function loadPosts(): Promise<SpotlightPost[]> {
  if (!cache || Date.now() - cache.at > 5 * 60_000) {
    const p = getDocs(query(collection(db(), 'socialPosts'), where('status', '==', 'published'), limit(120)))
      .then((s) => s.docs.map((d) => { const x = d.data(); return { id: d.id, type: x.type, category: typeof x.category === 'string' ? x.category : undefined, title: String(x.title ?? ''), caption: x.caption, body: x.body, thumbnailUrl: x.thumbnailUrl, imageUrl: x.imageUrl, videoUrl: x.videoUrl, status: x.status, featured: !!x.featured, order: typeof x.order === 'number' ? x.order : undefined, publishedAtMs: toDate(x.publishedAt)?.getTime() ?? 0 } as SpotlightPost; }))
      .catch((e) => { cache = null; throw e; });
    cache = { at: Date.now(), p };
  }
  return cache.p;
}
export function useSpotlight() {
  const [s, set] = useState<{ posts: SpotlightPost[]; loading: boolean; error: boolean }>({ posts: [], loading: true, error: false });
  useEffect(() => { let live = true; loadPosts().then((posts) => live && set({ posts: visiblePosts(posts), loading: false, error: false })).catch(() => live && set({ posts: [], loading: false, error: true })); return () => { live = false; }; }, []);
  return s;
}

const TYPE_LABEL = { image: 'Photo', video: 'Video', text: 'Article' } as const;
const TypeIcon = ({ t }: { t: SpotlightPost['type'] }) => (t === 'video' ? <Play className="h-3 w-3" /> : t === 'image' ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />);

/* ---------------------------------------------------------------- card */
function Card({ p, onOpen, tall = true }: { p: SpotlightPost; onOpen: () => void; tall?: boolean }) {
  const img = cardImage(p);
  return (
    <button type="button" onClick={onOpen} aria-label={`Open ${TYPE_LABEL[p.type].toLowerCase()}: ${p.title}`} className={`group relative block w-full overflow-hidden rounded-lg border border-line bg-forest-700 text-left shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-500 ${tall ? 'aspect-[4/5]' : 'aspect-video'}`}>
      {img ? <img src={img} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]" /> : <span className="absolute inset-0 bg-gradient-to-b from-forest-600 to-forest-800" />}
      <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 to-transparent" />
      <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white"><TypeIcon t={p.type} />{TYPE_LABEL[p.type]}</span>
      {p.category && <span className="absolute right-3 top-3 max-w-[60%] truncate rounded-full bg-gold-500/90 px-2 py-0.5 text-[11px] font-medium text-forest-900">{categoryLabel(categoryOf(p))}</span>}
      {p.type === 'video' && <span className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-forest-700"><Play className="h-5 w-5 translate-x-0.5" /></span>}
      <span className="absolute inset-x-0 bottom-0 p-3 text-white">
        <span className="block text-sm font-semibold leading-snug">{p.title}</span>
        {(p.caption || (p.type === 'text' && p.body)) && <span className="mt-1 line-clamp-2 block text-xs text-white/80">{p.caption || stripHtml(p.body ?? '').slice(0, 120)}</span>}
      </span>
    </button>
  );
}

/* ---------------------------------------------------------------- click-to-load video */
function VideoPlayer({ post }: { post: SpotlightPost }) {
  const v = useMemo(() => parseVideoUrl(post.videoUrl ?? ''), [post.videoUrl]);
  const [playing, setPlaying] = useState(false); const [slow, setSlow] = useState(false); const [failed, setFailed] = useState(false);
  const loaded = useRef(false);
  useEffect(() => { setPlaying(false); setSlow(false); setFailed(false); loaded.current = false; }, [post.id]);
  useEffect(() => { if (!playing || v?.provider === 'direct') return; const t = setTimeout(() => { if (!loaded.current) setSlow(true); }, 12000); return () => clearTimeout(t); }, [playing, v]);
  const img = cardImage(post);
  if (!v) return <p className="rounded bg-white/10 p-4 text-sm text-white">This video link is not valid, so it cannot be played here.</p>;
  if (v.provider === 'link') {
    // any other website: never framed, opened on its own site
    return (
      <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-3 overflow-hidden rounded-lg bg-black/60 p-4 text-center">
        {img && <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />}
        <a href={v.watchUrl} target="_blank" rel="noopener noreferrer" className="relative inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-medium text-forest-700"><Play className="h-5 w-5" />Watch on {v.label}</a>
        <p className="relative text-xs text-white/70">This video opens on its own website.</p>
      </div>
    );
  }
  return (
    <div className="w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        {!playing ? (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play video: ${post.title}`} className="absolute inset-0 flex items-center justify-center">
            {img && <img src={img} alt="" className="absolute inset-0 h-full w-full object-cover" />}
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-white/90 text-forest-700"><Play className="h-7 w-7 translate-x-0.5" /></span>
          </button>
        ) : failed ? <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-white">This video could not be loaded.</p>
          : v.provider === 'direct' ? <video src={v.embedUrl} controls autoPlay playsInline preload="none" poster={img ?? undefined} className="h-full w-full" onError={() => setFailed(true)} />
          : <iframe title={post.title} src={v.embedUrl} className="h-full w-full border-0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" onLoad={() => { loaded.current = true; setSlow(false); }} />}
      </div>
      {(slow || failed) && <p role="status" className="mt-2 text-sm text-gold-300">The video is taking long or is unavailable here. <a className="underline" href={v.watchUrl} target="_blank" rel="noopener noreferrer">Open it on {v.label}</a>.</p>}
      {playing && !slow && !failed && v.provider !== 'direct' && <p className="mt-2 text-xs text-white/60"><a className="underline" href={v.watchUrl} target="_blank" rel="noopener noreferrer">Having trouble? Open on {v.label}</a></p>}
    </div>
  );
}

/* ---------------------------------------------------------------- reels-style viewer */
export function Viewer({ posts, start, onClose }: { posts: SpotlightPost[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const go = useCallback((d: number) => setI((x) => stepIndex(x, d, posts.length)), [posts.length]);
  const post = posts[i];
  useEffect(() => {
    const prevOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const opener = document.activeElement as HTMLElement | null; closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); go(1); } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); go(-1); } };
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = prevOverflow; opener?.focus?.(); };
  }, [go, onClose]);
  if (!post) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={post.title} className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white"
      onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }}
      onTouchEnd={(e) => { const t = touch.current; touch.current = null; if (!t) return; const d = swipeDir(e.changedTouches[0].clientX - t.x, e.changedTouches[0].clientY - t.y); if (d) go(d); }}>
      <div className="flex items-center justify-between p-3">
        <span className="text-xs text-white/70">{i + 1} / {posts.length}</span>
        <span className="flex items-center gap-2"><ShareButton text={post.title + (post.caption ? ' — ' + post.caption : '')} path={`/spotlight?post=${post.id}`} /><button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="rounded-full bg-white/15 p-2 hover:bg-white/25"><X className="h-5 w-5" /></button></span>
      </div>
      <div key={post.id} className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col items-center gap-3 overflow-y-auto px-4 pb-6 motion-safe:animate-[fadeIn_.2s_ease-out]">
        {post.type === 'video' && <VideoPlayer post={post} />}
        {post.type === 'image' && post.imageUrl && <img src={post.imageUrl} alt={post.caption || post.title} className="max-h-[60vh] w-auto max-w-full rounded-lg object-contain" decoding="async" />}
        <div className="w-full"><h2 className="font-heading text-xl font-semibold !text-white">{post.title}</h2>
          {post.caption && <p className="mt-1 text-sm text-white/80">{post.caption}</p>}
          {post.body && <div className="prose-ela prose-invert mt-3 max-w-none text-white/90 [&_a]:text-gold-300 [&_h1]:text-white [&_h2]:text-white [&_h3]:text-white" dangerouslySetInnerHTML={{ __html: sanitizeHtml(post.body) }} />}</div>
      </div>
      {posts.length > 1 && <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        <button type="button" aria-label="Previous post" onClick={() => go(-1)} className="pointer-events-auto rounded-full bg-white/15 p-2 hover:bg-white/25"><ChevronUp className="h-5 w-5" /></button>
        <button type="button" aria-label="Next post" onClick={() => go(1)} className="pointer-events-auto rounded-full bg-white/15 p-2 hover:bg-white/25"><ChevronDown className="h-5 w-5" /></button></div>}
    </div>
  );
}

/* ---------------------------------------------------------------- homepage section */
export function SpotlightSection() {
  const { posts, loading, error } = useSpotlight();
  const [open, setOpen] = useState<number | null>(null);
  const shown = useMemo(() => homepagePosts(posts, 4), [posts]);
  if (loading || error || shown.length === 0) return null; // the homepage never shows an error for optional content
  return (
    <section className="bg-cream" aria-labelledby="spotlight-h">
      <div className="mx-auto max-w-7xl px-4 py-14 md:px-6 md:py-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold-500">ELA Spotlight</p><h2 id="spotlight-h" className="text-3xl font-semibold">From the ELA Community</h2><p className="mt-2 max-w-xl text-muted">Ideas, inspiration, learning and moments from our educational community.</p></div>
          <Link to="/spotlight" className="inline-flex items-center gap-1 font-medium text-forest-500 underline underline-offset-4">View all <ArrowRight className="h-4 w-4" /></Link>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{shown.map((p, k) => <Card key={p.id} p={p} onOpen={() => setOpen(k)} />)}</div>
      </div>
      {open !== null && <Viewer posts={shown} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/* ---------------------------------------------------------------- all posts page */
const FILTERS = [['all', 'All'], ['image', 'Photos'], ['video', 'Videos'], ['text', 'Articles']] as const;
const PAGE = 12;
export function SpotlightPage() {
  const { posts, loading, error } = useSpotlight();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState<(typeof FILTERS)[number][0]>('all');
  const [count, setCount] = useState(PAGE);
  const [cat, setCat] = useState('all');
  const cats = useMemo(() => categoriesInUse(posts), [posts]);
  const list = useMemo(() => posts.filter((p) => (f === 'all' || p.type === f) && (cat === 'all' || categoryOf(p) === cat)), [posts, f, cat]);
  const wanted = params.get('post');
  const open = wanted ? Math.max(-1, list.findIndex((p) => p.id === wanted)) : -1;
  useEffect(() => { document.title = 'From the ELA Community — Episteme Learning Academy'; }, []);
  useEffect(() => { if (wanted && !loading && posts.length && list.findIndex((p) => p.id === wanted) < 0) { setF('all'); setCat('all'); } }, [wanted, loading, posts, list]);
  const close = useCallback(() => setParams({}, { replace: true }), [setParams]);
  return (
    <div className="bg-cream">
      <header className="bg-forest-700 py-10 text-center text-white"><h1 className="font-heading text-3xl !text-white">From the ELA Community</h1><p className="mt-2 text-sm text-gold-300">Ideas, inspiration, learning and moments from our educational community.</p></header>
      <div className="mx-auto max-w-7xl px-4 py-8 pb-20 md:px-6">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter posts">{FILTERS.map(([id, label]) => <button key={id} role="tab" aria-selected={f === id} onClick={() => { setF(id); setCount(PAGE); }} className={`rounded-full border px-4 py-2 text-sm font-medium ${f === id ? 'border-forest-700 bg-forest-700 text-white' : 'border-line bg-white text-forest-700'}`}>{label}</button>)}</div>
        {cats.length > 1 && <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter by category">{[{ value: 'all', label: 'All categories', count: posts.length }, ...cats].map((c) => <button key={c.value} type="button" aria-pressed={cat === c.value} onClick={() => { setCat(c.value); setCount(PAGE); }} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${cat === c.value ? 'border-gold-500 bg-gold-500 text-forest-900' : 'border-line bg-white text-forest-700'}`}>{c.label} <span className="opacity-70">({c.count})</span></button>)}</div>}
        {loading && <p className="py-10 text-center text-sm text-muted">Loading…</p>}
        {error && <p className="py-10 text-center text-sm text-muted">Posts could not be loaded right now. Please try again shortly.</p>}
        {!loading && !error && list.length === 0 && <p className="py-10 text-center text-sm text-muted">Nothing here yet — please check back soon.</p>}
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">{list.slice(0, count).map((p) => <Card key={p.id} p={p} onOpen={() => setParams({ post: p.id })} />)}</div>
        {count < list.length && <div className="mt-8 text-center"><button className="rounded-md border border-line bg-white px-5 py-2 text-sm font-medium text-forest-700 hover:bg-forest-50" onClick={() => setCount(count + PAGE)}>Show more</button></div>}
      </div>
      {open >= 0 && <Viewer posts={list} start={open} onClose={close} />}
    </div>
  );
}
