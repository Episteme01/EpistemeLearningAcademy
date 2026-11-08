import { useEffect, useState } from 'react';
import { subscribeDoc } from '@/services/db';
import { C } from '@/config/collections';
import { firebaseConfigured } from '@/config/env';

/** Real-time settings document merged over built-in defaults (site works before CMS is populated). */
export function useSettings<T extends object>(id: string, defaults: T): T & { __loaded: boolean } {
  const [value, setValue] = useState<T>(defaults);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!firebaseConfigured) return;
    return subscribeDoc<T>(C.settings, id, (d) => { if (d) setValue({ ...defaults, ...d }); setLoaded(true); }, () => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return { ...value, __loaded: loaded };
}
