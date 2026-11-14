import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExternalLink, LayoutGrid, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/data';
import { clampPage, fitScale, stepZoom } from '@/lib/learning';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** One small page preview. It renders only when scrolled into view, so a 200-page PDF stays light. */
function Thumb({ doc, n, active, onPick }: { doc: PDFDocumentProxy; n: number; active: boolean; onPick: (n: number) => void }) {
  const box = useRef<HTMLButtonElement>(null); const cv = useRef<HTMLCanvasElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el); return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return; let task: RenderTask | null = null; let live = true;
    void doc.getPage(n).then((p) => {
      const c = cv.current; const ctx = c?.getContext('2d'); if (!live || !c || !ctx) return;
      const base = p.getViewport({ scale: 1 }); const vp = p.getViewport({ scale: 96 / base.width });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      task = p.render({ canvasContext: ctx, viewport: vp }); return task.promise;
    }).catch(() => undefined);
    return () => { live = false; task?.cancel(); };
  }, [seen, doc, n]);
  return (
    <button ref={box} type="button" onClick={() => onPick(n)} aria-label={`Go to page ${n}`} aria-current={active ? 'page' : undefined}
      className={`mb-2 block w-full rounded border p-1 text-center text-[11px] ${active ? 'border-forest-700 bg-forest-50' : 'border-line bg-white hover:bg-cream'}`}>
      <canvas ref={cv} className="mx-auto block max-w-full bg-white" width={96} height={124} />{n}
    </button>
  );
}

/**
 * In-page PDF reader (PDF.js): real page count, page thumbnails, fit-to-width zoom, keyboard arrows and full screen.
 * If the file cannot be loaded (blocked by the host, corrupt, offline) `onFail` lets the caller fall back to the browser's own viewer.
 */
export default function PdfJsViewer({ url, title, onFail }: { url: string; title: string; onFail: () => void }) {
  const box = useRef<HTMLDivElement>(null); const stage = useRef<HTMLDivElement>(null); const cv = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0); const [page, setPage] = useState(1); const [zoom, setZoom] = useState(100);
  const [width, setWidth] = useState(0); const [thumbs, setThumbs] = useState(false); const [busy, setBusy] = useState(true);
  const fail = useRef(onFail); fail.current = onFail;

  useEffect(() => {
    let live = true; setDoc(null); setPages(0); setPage(1); setBusy(true);
    const task = pdfjs.getDocument({ url });
    task.promise.then((d) => { if (!live) { void d.destroy(); return; } setDoc(d); setPages(d.numPages); setBusy(false); }).catch(() => { if (live) fail.current(); });
    return () => { live = false; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    const el = stage.current; if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    setWidth(el.clientWidth); ro.observe(el); return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || !width) return; let task: RenderTask | null = null; let live = true;
    void doc.getPage(page).then((p) => {
      const c = cv.current; const ctx = c?.getContext('2d'); if (!live || !c || !ctx) return;
      const base = p.getViewport({ scale: 1 });
      const scale = fitScale(width - 2, base.width, zoom); const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = p.getViewport({ scale: scale * dpr });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = `${Math.floor(vp.width / dpr)}px`; c.style.height = `${Math.floor(vp.height / dpr)}px`;
      task = p.render({ canvasContext: ctx, viewport: vp }); return task.promise;
    }).catch(() => undefined);
    return () => { live = false; task?.cancel(); };
  }, [doc, page, zoom, width]);

  const go = (n: number) => setPage(clampPage(n, pages));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(page + 1); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(page - 1); }
  };
  return (
    <div ref={box} className="space-y-2 bg-white" onKeyDown={onKey}>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="PDF controls">
        <Button size="icon" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)}>‹</Button>
        <label className="flex items-center gap-1 text-sm">Page <Input type="number" min={1} max={pages || undefined} value={page} onChange={(e) => go(Number(e.target.value))} className="h-9 w-16" aria-label="Page number" /> of {pages || '…'}</label>
        <Button size="icon" variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => go(page + 1)}>›</Button>
        <Button size="icon" variant="outline" aria-label="Zoom out" onClick={() => setZoom((z) => stepZoom(z, -1))}><Minus className="h-4 w-4" /></Button>
        <span className="w-12 text-center text-sm">{zoom}%</span>
        <Button size="icon" variant="outline" aria-label="Zoom in" onClick={() => setZoom((z) => stepZoom(z, 1))}><Plus className="h-4 w-4" /></Button>
        <Button size="sm" variant="outline" aria-pressed={thumbs} onClick={() => setThumbs((t) => !t)}><LayoutGrid className="h-4 w-4" /> Pages</Button>
        <Button size="sm" variant="outline" onClick={() => { void box.current?.requestFullscreen?.().catch(() => undefined); }}><Maximize2 className="h-4 w-4" /> Full screen</Button>
        <a href={url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Open</Button></a>
      </div>
      <div className="flex gap-2">
        {thumbs && doc && <div className="hidden max-h-[70vh] w-28 shrink-0 overflow-y-auto sm:block" aria-label="Page thumbnails">{Array.from({ length: pages }, (_, i) => <Thumb key={i + 1} doc={doc} n={i + 1} active={page === i + 1} onPick={go} />)}</div>}
        <div ref={stage} tabIndex={0} aria-label={`${title}, page ${page} of ${pages || '?'}`} className="max-h-[70vh] min-h-48 min-w-0 flex-1 overflow-auto rounded-md border border-line bg-cream p-px focus:outline-none focus:ring-2 focus:ring-forest-500">
          {busy ? <div className="grid h-48 place-items-center"><Spinner /></div> : <canvas ref={cv} className="mx-auto block bg-white" role="img" aria-label={`Page ${page}`} />}
        </div>
      </div>
      <p className="text-xs text-muted" role="status">Page {page} of {pages || '…'}. Use the arrow keys to turn pages.</p>
    </div>
  );
}
