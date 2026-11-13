import { collection, getDocs, query, where } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '@/config/firebase';
import { toDate } from '@/lib/utils';

export interface CmsItem {
  id: string; type: string; title: string; arabic?: string; body?: string; source?: string;
  /** videos only: quran | seerah | khutbah | kids | other. Missing (older items) = other. */
  category?: string;
  imageUrl?: string; videoUrl?: string; audioUrl?: string; link?: string; platform?: string; itemDate?: unknown; createdAt?: unknown;
}
let cached: Promise<CmsItem[]> | null = null;
/** All published Islamic content in one read (public rules allow status == published). */
export function loadCms(): Promise<CmsItem[]> {
  if (!cached) {
    cached = getDocs(query(collection(db(), 'islamicContent'), where('status', '==', 'published')))
      .then((s) => s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as CmsItem)
        .sort((a, b) => (toDate(b.itemDate ?? b.createdAt)?.getTime() ?? 0) - (toDate(a.itemDate ?? a.createdAt)?.getTime() ?? 0)))
      .catch((e) => { cached = null; throw e; });
  }
  return cached as Promise<CmsItem[]>;
}
export function useCmsType(type: string) {
  const [s, set] = useState<{ items: CmsItem[]; loading: boolean; error: boolean }>({ items: [], loading: true, error: false });
  useEffect(() => { let live = true; loadCms().then((all) => live && set({ items: all.filter((i) => i.type === type), loading: false, error: false })).catch(() => live && set({ items: [], loading: false, error: true })); return () => { live = false; }; }, [type]);
  return s;
}
