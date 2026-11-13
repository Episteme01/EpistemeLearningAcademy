import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { where } from 'firebase/firestore';
import { FileText, Presentation } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { EmptyState, Spinner, Badge } from '@/components/ui/data';
import { Input } from '@/components/ui/form';
import { Dialog } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection } from '@/hooks/useFirestore';
import { C } from '@/config/collections';
import { presentationKind } from '@/lib/learning';
import { ResourceViewer } from './LessonMedia';
import type { Resource, WithId } from '@/types/models';

const KIND_LABEL = { pdf: 'PDF', pptx: 'PowerPoint', slides: 'Google Slides', other: '' } as const;

/** Presentation library: the PDF / PowerPoint / Google Slides items of the Resources library, opened in the viewer. */
export function PresentationsPage() {
  const { uid, role } = useAuth();
  const manage = ['super_admin', 'admin', 'principal', 'teacher'].includes(role ?? '');
  const readAll = manage || role === 'director';
  const viewerRole = role === 'student' || role === 'parent' ? role : null;
  const q = useCollection<Resource>(C.resources, () => {
    if (!uid) return null;
    if (readAll) return [];
    if (viewerRole) return [where('published', '==', true), where('visibleTo', 'array-contains', viewerRole)];
    return null;
  }, `${role}|${uid}`);
  const [search, setSearch] = useState(''); const [open, setOpen] = useState<WithId<Resource> | null>(null);
  const rows = useMemo(() => q.data
    .map((r) => ({ r, kind: presentationKind({ url: r.url, fileName: r.fileName, contentType: r.contentType }) }))
    .filter((x) => x.kind !== 'other' && (readAll || x.r.published))
    .filter((x) => !search.trim() || `${x.r.title} ${x.r.subject ?? ''} ${x.r.className ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => a.r.title.localeCompare(b.r.title)), [q.data, search]);
  return (
    <div>
      <PageHeader title="Presentations" description="Slides and lesson decks shared by your teachers. PDFs and Google Slides open right here."
        actions={manage ? <Link to="/app/resources"><Button variant="outline">Add in Resources</Button></Link> : undefined} />
      <div className="mb-3 max-w-sm"><Input aria-label="Search presentations" placeholder="Search by title, subject or class" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {q.loading ? <Spinner /> : q.error ? <p className="text-sm text-danger">{q.error}</p> : rows.length === 0 ? <EmptyState title="No presentations yet" description={manage ? 'Upload a PDF or PowerPoint in Resources, or add a Google Slides link.' : 'Your teachers have not shared any yet.'} /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ r, kind }) => (
            <Card key={r.id}><CardBody>
              <div className="flex items-start gap-2">{kind === 'pdf' ? <FileText className="mt-0.5 h-5 w-5 text-forest-600" /> : <Presentation className="mt-0.5 h-5 w-5 text-gold-600" />}
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.title}</p><p className="text-xs text-muted">{[r.subject, r.className].filter(Boolean).join(' · ')}</p></div></div>
              <div className="mt-3 flex items-center justify-between"><Badge>{KIND_LABEL[kind]}</Badge>{!r.published && <Badge tone="warn">Not published</Badge>}<Button size="sm" onClick={() => setOpen(r)}>Open</Button></div>
            </CardBody></Card>
          ))}
        </div>
      )}
      {open && <Dialog open onClose={() => setOpen(null)} title={open.title} size="xl"><ResourceViewer resourceId={open.id} /></Dialog>}
    </div>
  );
}
