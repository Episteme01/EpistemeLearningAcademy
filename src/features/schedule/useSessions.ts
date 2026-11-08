import { useEffect, useMemo, useState } from 'react';
import { where } from 'firebase/firestore';
import { C } from '@/config/collections';
import { subscribeCollection } from '@/services/db';
import { monthKeysFor } from '@/lib/schedule/calendar';
import { errorMessage } from '@/lib/utils';
import type { Session, WithId } from '@/types/models';

/**
 * Live sessions for the months covering `dates`.
 * One listener per month bucket. Non-leaders add `viewers array-contains uid`, which the
 * security rules can prove, and which (being equality-only) needs no composite index.
 */
export function useSessions(dates: string[], uid: string | null, seeAll: boolean) {
  const keys = useMemo(() => monthKeysFor(dates), [dates.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [byKey, setByKey] = useState<Record<string, WithId<Session>[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const keyStr = keys.join(',') + (seeAll ? '|all' : '|me') + (uid ?? '');

  useEffect(() => {
    if (!uid) { setLoading(false); return; }
    setLoading(true); setError(null);
    let pending = keys.length;
    const unsubs = keys.map((k) => subscribeCollection<Session>(
      C.sessions,
      [where('monthKey', '==', k), ...(seeAll ? [] : [where('viewers', 'array-contains', uid)])],
      (rows) => { setByKey((m) => ({ ...m, [k]: rows })); if (pending > 0) { pending -= 1; if (pending === 0) setLoading(false); } },
      (e) => { setError(errorMessage(e)); setLoading(false); },
    ));
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr]);

  const sessions = useMemo(() => keys.flatMap((k) => byKey[k] ?? []), [keys, byKey]);
  return { sessions, loading, error };
}
