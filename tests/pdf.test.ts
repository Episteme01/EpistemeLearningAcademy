import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildAdmissionLetterPdf, pdfSafe, wrap } from '../src/lib/pdf/letterPdf';

// tiny valid PNG (w x h, solid colour) built by hand so the test needs no image files
function png(w: number, h: number, rgb: [number, number, number]): Uint8Array {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())])));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const data = { schoolName: 'Episteme Learning Academy', address: 'Ilorin, Kwara State', studentName: 'Amina Yusuf', firstName: 'Amina', studentNo: 'ELA/2026/014', className: 'JSS 1', admittedOn: '12 Sep 2024', signatoryName: 'Mr A. Bello' };
const imageCount = async (bytes: Uint8Array) => {
  const doc = await PDFDocument.load(bytes); let n = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) { const d = (obj as { dict?: { get(k: unknown): unknown } }).dict; if (d && String(d.get(PDFName.of('Subtype'))) === '/Image') n++; }
  return n;
};

describe('admission letter PDF', () => {
  it('is a valid A4 PDF with the learner photo embedded in the file', async () => {
    const bytes = await buildAdmissionLetterPdf(data, { photo: { bytes: png(30, 40, [20, 120, 60]), kind: 'png' } });
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(await imageCount(bytes)).toBe(1);
  });
  it('embeds photo, signature and stamp together', async () => {
    const i = (c: [number, number, number]) => ({ bytes: png(20, 20, c), kind: 'png' as const });
    expect(await imageCount(await buildAdmissionLetterPdf(data, { photo: i([1, 2, 3]), signature: i([9, 9, 9]), stamp: i([5, 5, 5]) }))).toBe(3);
  });
  it('still produces a letter without a photo, and ignores a corrupt image', async () => {
    expect(await imageCount(await buildAdmissionLetterPdf(data))).toBe(0);
    expect(await imageCount(await buildAdmissionLetterPdf(data, { photo: { bytes: new Uint8Array([1, 2, 3]), kind: 'png' } }))).toBe(0);
  });
  it('does not fail on non-Latin names', async () => {
    const bytes = await buildAdmissionLetterPdf({ ...data, studentName: 'Aminat عمر Yusuf' });
    expect(bytes.length > 1000).toBe(true);
  });
  it('wraps long text inside the width', async () => {
    const doc = await PDFDocument.create(); const { StandardFonts } = await import('pdf-lib'); const f = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrap(f, 'word '.repeat(80), 10, 200);
    expect(lines.length > 3).toBe(true);
    for (const l of lines) expect(f.widthOfTextAtSize(l, 10) <= 200).toBe(true);
    expect(pdfSafe(f, 'aعb')).toBe('a?b');
  });
});
