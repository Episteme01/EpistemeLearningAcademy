import { BRAND } from '@/config/brand';
import { useSettings } from '@/hooks/useSettings';

/** Signature, signatory name and school stamp. Uses the images set in School settings; falls back to the bundled ones. */
export function SignatureBlock({ label }: { label?: string }) {
  const school = useSettings<{ signatureUrl?: string; stampUrl?: string; signatoryName?: string; signatoryTitle?: string }>('school', {});
  const sig = school.signatureUrl || BRAND.signature;
  const stamp = school.stampUrl || BRAND.stamp;
  return (
    <div className="mt-6 flex items-end justify-between gap-4">
      <div className="text-center">
        <img src={sig} alt="" className="mx-auto h-12 max-w-[10rem] object-contain" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
        <div className="border-t border-ink px-6 pt-1">
          {school.signatoryName ? <p className="text-xs font-medium">{school.signatoryName}</p> : null}
          <p className="text-xs">{school.signatoryTitle || label || 'Principal'}</p>
        </div>
      </div>
      <img src={stamp} alt="" className="h-20 max-w-[8rem] object-contain opacity-80" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
    </div>
  );
}
