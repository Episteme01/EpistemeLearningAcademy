import { Spinner } from '@/components/ui/data';
import { useDocument } from '@/hooks/useFirestore';
import { useSignedUrl } from '@/hooks/useSignedUrl';
import { C } from '@/config/collections';
import { PresentationViewer } from './Viewers';
import type { Resource } from '@/types/models';

/** Opens a Resources-library item (private upload through a short-lived link, or a public/Google Slides link) in the presentation viewer. */
export function ResourceViewer({ resourceId, fallbackTitle }: { resourceId: string; fallbackTitle?: string }) {
  const r = useDocument<Resource>(C.resources, resourceId);
  const priv = !!r.data?.fileRef && !r.data.url;
  const signed = useSignedUrl('resources', resourceId, priv);
  if (r.loading || signed.loading) return <Spinner />;
  if (!r.data) return <p className="text-sm text-muted">This material is not available. It may be unpublished, or not shared with your role.</p>;
  const url = priv ? signed.url : r.data.url;
  if (!url) return <p className="text-sm text-danger">The file link could not be opened. Please try again in a moment.</p>;
  return <PresentationViewer url={url} title={r.data.title || fallbackTitle || 'Presentation'} fileName={r.data.fileName} contentType={r.data.contentType} />;
}
