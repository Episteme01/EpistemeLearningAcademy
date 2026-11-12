import type { PdfImage_ } from './letterPdf';

/**
 * Fetches an image and prepares it for a PDF: decodes any browser format (including WebP),
 * optionally crops it to a passport-style ratio ("cover"), and re-encodes it as JPEG or PNG.
 */
export async function loadPdfImage(url: string, opts: { aspect?: number; maxPx?: number; transparent?: boolean } = {}): Promise<PdfImage_ | undefined> {
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
    if (!res.ok) return undefined;
    const bmp = await createImageBitmap(await res.blob());
    const maxPx = opts.maxPx ?? 900;
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    if (opts.aspect) {                                  // centre-crop to width/height = aspect, biased to the top (faces)
      const cur = sw / sh;
      if (cur > opts.aspect) { const nw = sh * opts.aspect; sx = (sw - nw) / 2; sw = nw; }
      else { const nh = sw / opts.aspect; sy = Math.max(0, (sh - nh) * 0.2); sh = nh; }
    }
    const scale = Math.min(1, maxPx / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    const ctx = c.getContext('2d');
    if (!ctx) return undefined;
    if (!opts.transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const kind: 'png' | 'jpg' = opts.transparent ? 'png' : 'jpg';
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, kind === 'png' ? 'image/png' : 'image/jpeg', 0.9));
    return blob ? { bytes: new Uint8Array(await blob.arrayBuffer()), kind } : undefined;
  } catch { return undefined; }
}

/** Saves bytes as a file download (works offline once generated). */
export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
