import { useEffect, useState } from 'react';
import { signedUrlFor, type PrivateCollection } from '@/services/files';

/** Resolves a short-lived link for a private file (null while loading, or when access is denied). */
export function useSignedUrl(collection: PrivateCollection, docId: string | undefined, enabled = true): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>({ url: null, loading: !!docId && enabled });
  useEffect(() => {
    if (!docId || !enabled) { setState({ url: null, loading: false }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    void signedUrlFor(collection, docId).then((url) => { if (live) setState({ url, loading: false }); });
    return () => { live = false; };
  }, [collection, docId, enabled]);
  return state;
}
