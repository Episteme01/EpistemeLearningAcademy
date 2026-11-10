import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/overlay';
import { BRAND } from '@/config/brand';
import { useSettings } from '@/hooks/useSettings';
import { fmtDate, todayISO } from '@/lib/utils';
import { fullName } from '@/services/ems';
import type { Student } from '@/types/models';

const DEFAULTS = { schoolName: BRAND.name, address: BRAND.location, admissionNote: '' };

/** Only learners who have actually been admitted get a letter. */
export const canPrintAdmissionLetter = (s: Pick<Student, 'admissionStatus'>) => s.admissionStatus === 'admitted' || s.admissionStatus === 'enrolled';

/** Printable admission letter. Shared by the staff, parent and student portals (print or save as PDF). */
export function AdmissionLetterDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const school = useSettings('school', DEFAULTS);
  const name = student ? fullName(student) : '';
  return (
    <Dialog open={!!student} onClose={onClose} size="lg" title="Admission letter" footer={<Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>}>
      {student && (
        <div className="print-area space-y-5 text-sm leading-relaxed">
          <div className="flex items-center gap-3 border-b-2 border-forest-700 pb-3">
            <img src={BRAND.logo} alt="" className="h-14 w-14" />
            <div><p className="font-heading text-lg font-semibold text-forest-700">{school.schoolName}</p><p className="text-xs text-muted">{school.address}</p></div>
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
          <div className="pt-6"><p>Yours sincerely,</p><div className="mt-8 w-56 border-t border-ink pt-1"><p className="font-medium">The Principal</p><p className="text-xs text-muted">{school.schoolName}</p></div></div>
        </div>
      )}
    </Dialog>
  );
}
