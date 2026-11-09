import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardBody, PageHeader } from '@/components/ui/card';
import { TableWrap, Td, Th } from '@/components/ui/data';
import { listDocs } from '@/services/db';
import { C } from '@/config/collections';
import { providerOfUrl } from '@/lib/fileRef';
import { toCsv } from '@/lib/csv';
import { downloadText, errorMessage } from '@/lib/utils';

const SOURCES: { collection: string; label: string; fields: string[] }[] = [
  { collection: C.students, label: 'Student photos', fields: ['photoUrl'] },
  { collection: C.users, label: 'User photos', fields: ['photoUrl'] },
  { collection: C.media, label: 'Media library', fields: ['url'] },
  { collection: C.submissions, label: 'Submissions', fields: ['fileUrl'] },
  { collection: C.resources, label: 'Resources', fields: ['url'] },
  { collection: C.pages, label: 'Pages (image, social image)', fields: ['image', 'ogImage'] },
  { collection: C.posts, label: 'Posts', fields: ['image'] },
  { collection: C.courses, label: 'Course thumbnails', fields: ['thumbnail'] },
];
interface Hit { area: string; id: string; field: string; url: string }

/** Read-only list of every record that still points at the old Firebase Storage. Changes nothing. */
export function StorageInventory() {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const scan = async () => {
    setBusy(true); setErr('');
    try {
      const out: Hit[] = [];
      for (const s of SOURCES) {
        const rows = await listDocs<Record<string, unknown>>(s.collection, []).catch(() => []);
        for (const r of rows) for (const f of s.fields) { const v = r[f]; if (typeof v === 'string' && v && providerOfUrl(v) === 'firebase') out.push({ area: s.label, id: r.id, field: f, url: v }); }
      }
      setHits(out);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Storage inventory" description="Records that still use the old Firebase Storage. This page only reads; nothing is changed or deleted."
        actions={<><Button loading={busy} onClick={() => void scan()}>Scan now</Button>{hits?.length ? <Button variant="outline" onClick={() => downloadText('firebase-storage-references.csv', toCsv([['Area', 'Record', 'Field', 'URL'], ...hits.map((h) => [h.area, h.id, h.field, h.url])]))}><Download className="h-4 w-4" /> CSV</Button> : null}</>} />
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}
      {hits && <Card><CardBody>{hits.length === 0 ? <p className="text-sm">No record points at Firebase Storage. It is safe to retire the old bucket (keep a backup first).</p> : <p className="mb-3 text-sm">{hits.length} record(s) still use Firebase Storage. They keep working while the old bucket exists. Re-upload them over time with the new upload buttons.</p>}
        {hits.length > 0 && <TableWrap><thead><tr><Th>Area</Th><Th>Record</Th><Th>Field</Th></tr></thead><tbody>{hits.slice(0, 300).map((h, i) => <tr key={i}><Td>{h.area}</Td><Td className="font-mono text-xs">{h.id}</Td><Td>{h.field}</Td></tr>)}</tbody></TableWrap>}</CardBody></Card>}
    </>
  );
}
