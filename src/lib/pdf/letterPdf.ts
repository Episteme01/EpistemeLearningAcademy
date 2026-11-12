import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/** Image bytes ready to embed. Photos are cropped/converted in the browser first (see pdfImages.ts). */
export interface PdfImage_ { bytes: Uint8Array; kind: 'png' | 'jpg' }

export interface LetterData {
  schoolName: string; address: string; studentName: string; firstName: string; studentNo: string;
  className?: string; programme?: string; guardianAddress?: string; admittedOn: string;   // already formatted, e.g. "12 Sep 2024"
  note?: string; signatoryName?: string; signatoryTitle?: string;
}
export interface LetterImages { logo?: PdfImage_; photo?: PdfImage_; signature?: PdfImage_; stamp?: PdfImage_ }

const FOREST = rgb(0x0b / 255, 0x3d / 255, 0x2e / 255);
const GOLD = rgb(0xc8 / 255, 0xa4 / 255, 0x5a / 255);
const GREY = rgb(0.4, 0.4, 0.4);
const LINE = rgb(0.82, 0.82, 0.8);
const CREAM = rgb(0xfa / 255, 0xf9 / 255, 0xf5 / 255);

/** Standard PDF fonts only know Latin text; replace anything else instead of failing the whole download. */
export function pdfSafe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (ch === '\n') { out += ch; continue; }
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

export function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of pdfSafe(font, text).split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(t, size) <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = word; }
    }
    lines.push(cur);
  }
  return lines;
}

async function embed(doc: PDFDocument, img?: PdfImage_): Promise<PDFImage | undefined> {
  if (!img || img.bytes.length === 0) return undefined;
  try { return img.kind === 'png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes); } catch { return undefined; }   // a bad image never blocks the letter
}

function fit(img: PDFImage, boxW: number, boxH: number) {
  const s = Math.min(boxW / img.width, boxH / img.height);
  return { w: img.width * s, h: img.height * s };
}

/** Builds the admission letter as a real A4 PDF with the learner's photograph embedded in the file. */
export async function buildAdmissionLetterPdf(d: LetterData, images: LetterImages = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Admission letter - ${d.studentName}`); doc.setAuthor(d.schoolName); doc.setSubject('Letter of admission');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = doc.addPage([595.28, 841.89]);
  const M = 48; const W = 595.28 - 2 * M;
  const [logo, photo, sig, stamp] = await Promise.all([embed(doc, images.logo), embed(doc, images.photo), embed(doc, images.signature), embed(doc, images.stamp)]);
  let y = 841.89 - M;

  // header: logo, school, photo
  const PH_W = 78; const PH_H = 100;
  let textX = M;
  if (logo) { const f = fit(logo, 52, 52); page.drawImage(logo, { x: M, y: y - f.h, width: f.w, height: f.h }); textX = M + 64; }
  page.drawText(pdfSafe(bold, d.schoolName), { x: textX, y: y - 18, size: 16, font: bold, color: FOREST });
  wrap(reg, d.address, 9, W - (textX - M) - PH_W - 14).slice(0, 2).forEach((l, i) => page.drawText(l, { x: textX, y: y - 33 - i * 12, size: 9, font: reg, color: GREY }));
  const photoX = M + W - PH_W;
  page.drawRectangle({ x: photoX, y: y - PH_H, width: PH_W, height: PH_H, borderColor: FOREST, borderWidth: 1.2, color: CREAM });
  if (photo) { const f = fit(photo, PH_W - 4, PH_H - 4); page.drawImage(photo, { x: photoX + (PH_W - f.w) / 2, y: y - PH_H + (PH_H - f.h) / 2, width: f.w, height: f.h }); }
  else page.drawText('Photo', { x: photoX + PH_W / 2 - 12, y: y - PH_H / 2, size: 9, font: reg, color: GREY });
  y -= PH_H + 10;
  page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 2, color: FOREST });
  page.drawLine({ start: { x: M, y: y - 3 }, end: { x: M + W, y: y - 3 }, thickness: 0.6, color: GOLD });
  y -= 26;

  page.drawText(`Ref: ${pdfSafe(reg, d.studentNo)}`, { x: M, y, size: 9, font: reg, color: GREY });
  const dt = `Date: ${pdfSafe(reg, d.admittedOn)}`; page.drawText(dt, { x: M + W - reg.widthOfTextAtSize(dt, 9), y, size: 9, font: reg, color: GREY });
  y -= 26;
  page.drawText('The Parent / Guardian of', { x: M, y, size: 10.5, font: reg }); y -= 15;
  page.drawText(pdfSafe(bold, d.studentName), { x: M, y, size: 11, font: bold }); y -= 14;
  if (d.guardianAddress) for (const l of wrap(reg, d.guardianAddress, 9.5, W / 2)) { page.drawText(l, { x: M, y, size: 9.5, font: reg, color: GREY }); y -= 12; }
  y -= 14;
  const title = 'LETTER OF ADMISSION'; page.drawText(title, { x: M + (W - bold.widthOfTextAtSize(title, 13)) / 2, y, size: 13, font: bold, color: FOREST }); y -= 26;

  const para = (text: string, size = 10.5, f = reg) => { for (const l of wrap(f, text, size, W)) { page.drawText(l, { x: M, y, size, font: f }); y -= size + 4.5; } y -= 6; };
  para('Dear Parent / Guardian,');
  para(`We are pleased to inform you that ${d.studentName} has been admitted to ${d.schoolName}${d.className ? ` into ${d.className}` : ''}${d.programme ? ` (${d.programme})` : ''}. Congratulations!`);

  const rows: [string, string][] = [['Learner', d.studentName], ['Admission number', d.studentNo], ['Class', d.className || '-'], ['Programme', d.programme || '-'], ['Date of admission', d.admittedOn]];
  const RH = 22; const C1 = W * 0.34;
  for (const [k, v] of rows) {
    page.drawRectangle({ x: M, y: y - RH + 6, width: C1, height: RH, color: CREAM, borderColor: LINE, borderWidth: 0.8 });
    page.drawRectangle({ x: M + C1, y: y - RH + 6, width: W - C1, height: RH, borderColor: LINE, borderWidth: 0.8 });
    page.drawText(pdfSafe(bold, k), { x: M + 8, y: y - 9, size: 10, font: bold });
    page.drawText(pdfSafe(reg, v), { x: M + C1 + 8, y: y - 9, size: 10, font: reg });
    y -= RH;
  }
  y -= 16;
  if (d.note) { page.drawText('Please note', { x: M, y, size: 10.5, font: bold }); y -= 15; para(d.note, 10); }
  para(`Please keep this letter and quote the admission number above in all correspondence with the school. We look forward to welcoming ${d.firstName} and working with you.`);
  y -= 6; para('Yours sincerely,');

  // signature, signatory, stamp
  const sigTop = y;
  if (sig) { const f = fit(sig, 130, 46); page.drawImage(sig, { x: M, y: sigTop - f.h, width: f.w, height: f.h }); }
  y = sigTop - 52;
  page.drawLine({ start: { x: M, y }, end: { x: M + 170, y }, thickness: 0.8, color: rgb(0, 0, 0) });
  if (d.signatoryName) { page.drawText(pdfSafe(bold, d.signatoryName), { x: M, y: y - 12, size: 9.5, font: bold }); y -= 12; }
  page.drawText(pdfSafe(reg, d.signatoryTitle || 'Principal'), { x: M, y: y - 12, size: 9.5, font: reg });
  page.drawText(pdfSafe(reg, d.schoolName), { x: M, y: y - 25, size: 9, font: reg, color: GREY });
  if (stamp) { const f = fit(stamp, 110, 80); page.drawImage(stamp, { x: M + W - f.w - 10, y: sigTop - f.h + 8, width: f.w, height: f.h, opacity: 0.85 }); }

  return doc.save();
}
