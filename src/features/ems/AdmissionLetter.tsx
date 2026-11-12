import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, useToast } from '@/components/ui/overlay';
import { BRAND } from '@/config/brand';
import { useSettings } from '@/hooks/useSettings';
import { fmtDate, todayISO } from '@/lib/utils';
import { SecureAvatar } from '@/components/common/SecureAvatar';
import { SignatureBlock } from './SignatureBlock';
import { fullName } from '@/services/ems';
import { signedUrlFor } from '@/services/files';
import { buildAdmissionLetterPdf } from '@/lib/pdf/letterPdf';
import { downloadBytes, loadPdfImage } from '@/lib/pdf/pdfImages';
import { errorMessage } from '@/lib/utils';
import type { Student } from '@/types/models';

const DEFAULTS = { schoolName: BRAND.name, address: BRAND.location, admissionNote: '', signatureUrl: '', stampUrl: '', signatoryName: '', signatoryTitle: '' };
const abs = (u: string) => (/^https?:|^data:|^blob:/.test(u) ? u : new URL(u, window.location.origin).toString());

/** Only learners who have actually been admitted get a letter. */
export const canPrintAdmissionLetter = (s: Pick<Student, 'admissionStatus'>) => s.admissionStatus === 'admitted' || s.admissionStatus === 'enrolled';

/** Printable admission letter. Shared by the staff, parent and student portals (print or save as PDF). */
export function AdmissionLetterDialog({ student, onClose }: { student: (Student & { id: string }) | null; onClose: () => void }) {
  const school = useSettings('school', DEFAULTS);
  const name = student ? fullName(student) : '';
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  /** A real PDF file: the learner's photo is embedded in it, so it still shows offline. */
  const download = async () => {
    if (!student) return;
    setBusy(true);
    try {
      const priv = student.photoRef?.provider === 'supabase';
      const photoUrl = priv ? await signedUrlFor('students', student.id) : student.photoRef?.url || student.photoUrl || null;
      const [photo, logo, signature, stamp] = await Promise.all([
        photoUrl ? loadPdfImage(photoUrl, { aspect: 3 / 4, maxPx: 700 }) : Promise.resolve(undefined),
        loadPdfImage(abs(BRAND.logo), { transparent: true, maxPx: 300 }),
        loadPdfImage(abs(school.signatureUrl || BRAND.signature), { transparent: true, maxPx: 500 }),
        loadPdfImage(abs(school.stampUrl || BRAND.stamp), { transparent: true, maxPx: 500 }),
      ]);
      if (photoUrl && !photo) toast.error('The learner photo could not be loaded, so the letter has an empty photo box. Check your connection and try again.');
      const bytes = await buildAdmissionLetterPdf({
        schoolName: school.schoolName, address: school.address, studentName: name, firstName: student.firstName, studentNo: student.studentNo,
        className: student.className, programme: student.programme, guardianAddress: student.address, admittedOn: fmtDate(student.admittedAt || todayISO()),
        note: school.admissionNote, signatoryName: school.signatoryName, signatoryTitle: school.signatoryTitle,
      }, { photo, logo, signature, stamp });
      downloadBytes(`Admission-letter-${student.studentNo.replace(/[^\w-]+/g, '_')}.pdf`, bytes);
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!student} onClose={onClose} size="lg" title="Admission letter" footer={<><Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</Button><Button loading={busy} onClick={() => void download()}><Download className="h-4 w-4" /> Download PDF</Button></>}>
      {student && (
        <div className="print-area space-y-5 text-sm leading-relaxed">
          <div className="flex items-center gap-3 border-b-2 border-forest-700 pb-3">
            <img src={BRAND.logo} alt="" className="h-14 w-14" />
            <div className="flex-1"><p className="font-heading text-lg font-semibold text-forest-700">{school.schoolName}</p><p className="text-xs text-muted">{school.address}</p></div>
            <SecureAvatar name={name} collection="students" docId={student.id} photoRef={student.photoRef} legacyUrl={student.photoUrl} size={88} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs text-muted"><span>Ref: {student.studentNo}</span><span>Date: {fmtDate(student.admittedAt || todayISO())}</span></div>
          <div><p>The Parent / Guardian of</p><p className="font-semibold">{name}</p>{student.address && <p className="text-muted">{student.address}</p>}</div>
          <h2 className="text-center font-heading text-base font-semibold uppercase tracking-wide text-forest-700">Letter of admission</h2>
          <p>Dear Parent / Guardian,</p>
          <p>We are pleased to inform you that <strong>{name}</strong> has been admitted to <strong>{school.schoolName}</strong>{student.className ? <> into <strong>{student.className}</strong></> : null}{student.programme ? <> ({student.programme})</> : null}. Congratulations!</p>
          <table className="w-full border-collapse text-sm"><tbody>
            {[['Learner', name], ['Admission number', student.studentNo], ['Class', student.className || '—'], ['Programme', student.programme || '—'], ['Date of admission', fmtDate(student.admittedAt || todayISO())]].map(([k, v]) => (
              <tr key={k}><th className="w-1/3 border border-line bg-cream px-3 py-1.5 text-left font-medium">{k}</th><td className="border border-line px-3 py-1.5">{v}</td></tr>
            ))}
          </tbody></table>
          {school.admissionNote && <div><p className="font-semibold">Please note</p><p className="whitespace-pre-line">{school.admissionNote}</p></div>}
          <p>Please keep this letter and quote the admission number above in all correspondence with the school. We look forward to welcoming {student.firstName} and working with you.</p>
          <div className="pt-4"><p>Yours sincerely,</p><SignatureBlock /><p className="mt-1 text-xs text-muted">{school.schoolName}</p></div>
        </div>
      )}
    </Dialog>
  );
}
