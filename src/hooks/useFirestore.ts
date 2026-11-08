import { useEffect, useState } from 'react';
import type { QueryConstraint } from 'firebase/firestore';
import { subscribeCollection, subscribeDoc } from '@/services/db';
import type { WithId } from '@/types/models';
import { errorMessage } from '@/lib/utils';

interface ListState<T> { data: WithId<T>[]; loading: boolean; error: string | null }

/**
 * Real-time collection listener. Pass `null` constraints to skip (e.g. until a
 * dependency is ready). `key` must change whenever the constraints change.
 */
export function useCollection<T>(name: string, build: () => QueryConstraint[] | null, key: string = ''): ListState<T> {
  const [state, setState] = useState<ListState<T>>({ data: [], loading: true, error: null });
  useEffect(() => {
    const constraints = build();
    if (constraints === null) {
      setState({ data: [], loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const unsub = subscribeCollection<T>(
      name,
      constraints,
      (rows) => setState({ data: rows, loading: false, error: null }),
      (e) => setState({ data: [], loading: false, error: errorMessage(e) }),
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);
  return state;
}

export function useDocument<T>(name: string, id: string | null | undefined) {
  const [state, setState] = useState<{ data: WithId<T> | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  useEffect(() => {
    if (!id) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return subscribeDoc<T>(
      name,
      id,
      (row) => setState({ data: row, loading: false, error: null }),
      (e) => setState({ data: null, loading: false, error: errorMessage(e) }),
    );
  }, [name, id]);
  return state;
}
