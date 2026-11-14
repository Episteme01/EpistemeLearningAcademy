import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Maximize2, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Spinner } from '@/components/ui/data';
import { addPlayed, clampPage, googleSlidesEmbed, officeViewerSrc, pdfSrc, presentationKind, stepZoom, unpackRanges, watchedPct, type Range } from '@/lib/learning';
import { parseVideoUrl } from '@/lib/spotlight';

// PDF.js is large, so it is only downloaded when a learner actually opens a PDF.
const PdfJsViewer = lazy(() => import('./PdfJsViewer'));

/** Opens a presentation. PDFs use the in-page PDF.js reader (browser viewer as fallback); Google Slides are embedded; PowerPoint files open in Microsoft's online viewer on request, or can be downloaded. */
export function PresentationViewer({ url, title, fileName, contentType }: { url: string; title: string; fileName?: string; contentType?: string }) {
  const kind = presentationKind({ url, fileName, contentType });
  const box = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1); const [zoom, setZoom] = useState(100);
  const [pdfFailed, setPdfFailed] = useState(false); const [office, setOffice] = useState(false);
  const fullscreen = () => { void box.current?.requestFullscreen?.().catch(() => undefined); };
  if (kind === 'slides') {
    const src = googleSlidesEmbed(url)!;
    return (
      <div ref={box} className="space-y-2 bg-white">
        <div className="aspect-[16/9] w-full overflow-hidden rounded-md border border-line bg-cream"><iframe title={title} src={src} className="h-full w-full" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" referrerPolicy="no-referrer" loading="lazy" /></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="h-4 w-4" /> Full screen</Button><a href={url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Open in Google Slides</Button></a></div>
        <p className="text-xs text-muted">The deck must be shared as “anyone with the link can view” (or published to the web) for learners to see it.</p>
      </div>
    );
  }
  if (kind === 'pdf' && !pdfFailed) {
    return <div ref={box}><Suspense fallback={<div className="grid h-48 place-items-center"><Spinner /></div>}><PdfJsViewer url={url} title={title} onFail={() => setPdfFailed(true)} /></Suspense></div>;
  }
  if (kind === 'pdf') {
    return (
      <div ref={box} className="space-y-2 bg-white">
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="PDF controls">
          <Button size="icon" variant="outline" aria-label="Previous page" onClick={() => setPage((p) => clampPage(p - 1))}>‹</Button>
          <label className="flex items-center gap-1 text-sm">Page <Input type="number" min={1} value={page} onChange={(e) => setPage(clampPage(Number(e.target.value)))} className="h-9 w-16" aria-label="Page number" /></label>
          <Button size="icon" variant="outline" aria-label="Next page" onClick={() => setPage((p) => clampPage(p + 1))}>›</Button>
          <Button size="icon" variant="outline" aria-label="Zoom out" onClick={() => setZoom((z) => stepZoom(z, -1))}><Minus className="h-4 w-4" /></Button>
          <span className="w-12 text-center text-sm">{zoom}%</span>
          <Button size="icon" variant="outline" aria-label="Zoom in" onClick={() => setZoom((z) => stepZoom(z, 1))}><Plus className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="h-4 w-4" /> Full screen</Button>
          <a href={url} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><ExternalLink className="h-4 w-4" /> Open</Button></a>
        </div>
        <iframe key={`${page}-${zoom}`} title={title} src={pdfSrc(url, page, zoom)} className="h-[70vh] w-full rounded-md border border-line bg-cream" />
        <p className="text-xs text-muted">If the page does not appear (some phone browsers cannot show PDFs inside a page), use “Open”. Page and zoom buttons rely on your browser’s own PDF viewer.</p>
      </div>
    );
  }
  const officeSrc = kind === 'pptx' ? officeViewerSrc(url) : null;
  if (kind === 'pptx' && office && officeSrc) {
    return (
      <div ref={box} className="space-y-2 bg-white">
        <div className="aspect-[16/10] w-full overflow-hidden rounded-md border border-line bg-cream"><iframe title={title} src={officeSrc} className="h-full w-full" allowFullScreen sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerPolicy="no-referrer" /></div>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={fullscreen}><Maximize2 className="h-4 w-4" /> Full screen</Button><a href={url} target="_blank" rel="noopener noreferrer" download={fileName}><Button size="sm" variant="outline"><Download className="h-4 w-4" /> Download</Button></a></div>
        <p className="text-xs text-muted">If the slides do not appear, the link may have expired or the file may be too large for the viewer. Close and reopen this page, or download the file.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-md border border-line bg-cream p-4 text-sm">
      <p>{kind === 'pptx' ? 'Your browser cannot display PowerPoint files itself, but you can view the slides here using Microsoft’s free online viewer, or download the file.' : 'This file type cannot be previewed here.'}</p>
      <div className="flex flex-wrap gap-2">
        {officeSrc && <Button onClick={() => setOffice(true)}><Maximize2 className="h-4 w-4" /> View slides here</Button>}
        <a href={url} target="_blank" rel="noopener noreferrer" download={fileName}><Button variant={officeSrc ? 'outline' : 'primary'}><Download className="h-4 w-4" /> Download {fileName || title}</Button></a>
      </div>
      {officeSrc && <p className="text-xs text-muted">“View slides here” sends a temporary link to this file to Microsoft so it can draw the slides. Nothing is sent unless you press it.</p>}
      {kind === 'pptx' && !officeSrc && <p className="text-xs text-muted">This file’s link cannot be opened by the online viewer. Tip for teachers: export the deck as PDF, or share it as a Google Slides link.</p>}
    </div>
  );
}

export interface VideoState { ranges: Range[]; pct: number; positionSec: number; durationSec: number }
/**
 * Plays a lesson video. Direct video files are measured (real playback only, seeking does not count). YouTube / Vimeo / Drive
 * players cannot be measured from this page, so no "watched" claim is ever made for them.
 */
export function VideoPlayer({ url, title, saved, onProgress }: { url: string; title: string; saved?: { ranges?: unknown; positionSec?: number }; onProgress?: (s: VideoState) => void }) {
  const parsed = parseVideoUrl(url);
  const vid = useRef<HTMLVideoElement>(null);
  const ranges = useRef<Range[]>(unpackRanges(saved?.ranges));
  const last = useRef<number | null>(null); const lastSave = useRef(0);
  const [pct, setPct] = useState(() => 0);
  const resumed = useRef(false);
  const cb = useRef(onProgress); cb.current = onProgress;
  useEffect(() => { ranges.current = unpackRanges(saved?.ranges); }, [saved?.ranges]);
  if (!parsed) return <p className="text-sm text-danger">This video link is not supported. Use a YouTube, Vimeo, Google Drive or direct https .mp4/.webm link.</p>;
  if (parsed.provider === 'link') {
    return <div className="space-y-2 rounded-md border border-line bg-cream p-4 text-sm"><a href={parsed.watchUrl} target="_blank" rel="noopener noreferrer"><Button><ExternalLink className="h-4 w-4" /> Watch on {parsed.label}</Button></a><p className="text-xs text-muted">This video opens on its own website, so progress cannot be tracked. Confirm with “Mark complete” once you have watched it.</p></div>;
  }
  if (parsed.provider !== 'direct') {
    return (
      <div className="space-y-2">
        <div className="aspect-video overflow-hidden rounded-md bg-black"><iframe title={title} src={parsed.embedUrl.replace('autoplay=1', 'autoplay=0')} className="h-full w-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" referrerPolicy="no-referrer" loading="lazy" /></div>
        <p className="text-xs text-muted">{parsed.label} videos cannot be tracked by this site, so progress is not measured. Confirm with “Mark complete” once you have watched it. <a className="underline" href={parsed.watchUrl} target="_blank" rel="noopener noreferrer">Open on {parsed.label}</a></p>
      </div>
    );
  }
  const emit = (force = false) => {
    const v = vid.current; if (!v || !(v.duration > 0)) return;
    const p = watchedPct(ranges.current, v.duration); setPct(p);
    const now = Date.now();
    if (force || now - lastSave.current > 15000) { lastSave.current = now; cb.current?.({ ranges: ranges.current, pct: p, positionSec: v.currentTime, durationSec: v.duration }); }
  };
  return (
    <div className="space-y-2">
      <video ref={vid} controls preload="metadata" playsInline className="w-full rounded-md bg-black" src={parsed.embedUrl} title={title}
        onLoadedMetadata={() => { const v = vid.current; if (v && !resumed.current && saved?.positionSec && saved.positionSec < v.duration - 5) v.currentTime = saved.positionSec; resumed.current = true; emit(); }}
        onTimeUpdate={() => { const v = vid.current; if (!v || v.paused || v.seeking) { last.current = v?.currentTime ?? null; return; } if (last.current != null) ranges.current = addPlayed(ranges.current, last.current, v.currentTime); last.current = v.currentTime; emit(); }}
        onSeeked={() => { last.current = vid.current?.currentTime ?? null; }} onPause={() => emit(true)} onEnded={() => emit(true)} />
      <p className="text-xs text-muted" role="status">Watched so far: {pct}% (only time actually played counts; skipping ahead does not).</p>
    </div>
  );
}
