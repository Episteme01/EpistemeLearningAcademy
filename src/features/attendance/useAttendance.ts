import { useEffect, useMemo, useState } from 'react';
import { C } from '@/config/collections';
import { subscribeDoc } from '@/services/db';
import { useCollection } from '@/hooks/useFirestore';
import { DEFAULT_GRACE_MINUTES } from '@/lib/attendance';
import type { Student, WithId } from '@/types/models';

/** On-time grace period (minutes) from settings/attendance, falling back to the default. */
export function useGrace(): number {
  const [g, setG] = useState(DEFAULT_GRACE_MINUTES);
  useEffect(() => subscribeDoc<{ onTimeGraceMinutes?: number }>(C.settings, 'attendance', (r) => {
    const v = Number(r?.onTimeGraceMinutes);
    setG(Number.isFinite(v) && v >= 0 && v <= 60 ? v : DEFAULT_GRACE_MINUTES);
  }, () => undefined), []);
  return g;
}

/** Student login uid -> display name, for staff who may read the students collection. */
export function useStudentNames(enabled: boolean) {
  const st = useCollection<Student>(C.students, () => (enabled ? [] : null), enabled ? 'on' : 'off');
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of st.data) if (s.studentUid) m[s.studentUid] = `${s.firstName} ${s.lastName}`.trim();
    return m;
  }, [st.data]);
  const byUid = useMemo(() => {
    const m: Record<string, WithId<Student>> = {};
    for (const s of st.data) if (s.studentUid) m[s.studentUid] = s;
    return m;
  }, [st.data]);
  return { names, byUid, students: st.data, loading: st.loading };
}
