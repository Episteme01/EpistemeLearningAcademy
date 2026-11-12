import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addDoc, collection, orderBy, query, getDocs, limit, setDoc, doc, serverTimestamp, where } from 'firebase/firestore';
import { Eye, EyeOff, History } from 'lucide-react';
import { CrudPage, type CrudConfig } from '@/components/common/CrudPage';
import { EntityForm } from '@/components/common/EntityForm';
import type { FieldDef } from '@/components/common/crudFields';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, PageHeader, StatCard } from '@/components/ui/card';
import { StatusBadge, Spinner, EmptyState } from '@/components/ui/data';
import { Dialog, useToast } from '@/components/ui/overlay';
import { useAuth } from '@/features/auth/AuthContext';
import { useCollection, useDocument } from '@/hooks/useFirestore';
import { useSettings } from '@/hooks/useSettings';
import { patchDoc, createDoc } from '@/services/db';
import { audit } from '@/services/audit';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { can } from '@/config/permissions';
import { errorMessage, fmtDate, slugify, toDate } from '@/lib/utils';
import { Rich } from '@/features/public/pages';
import { DEFAULT_NAV } from '@/features/public/content';
import { SITE_DEFAULTS } from '@/features/public/PublicLayout';
import legacyPosts from '@/data/legacyPosts.json';
import { spotlightSchema } from '@/lib/spotlight';

type Row = Record<string, unknown> & { id: string };
const STATUS = [{ value: 'draft', label: 'Draft' }, { value: 'review', label: 'In review' }, { value: 'published', label: 'Published' }];

/* ---------------------------------------------------- pages + posts manager */
interface Content extends Row { title: string; slug?: string; body: string; status: string; publishedAt?: unknown; updatedAt?: unknown; category?: string }

function Revisions({ coll, row, onClose }: { coll: string; row: Content | null; onClose: () => void }) {
  const toast = useToast();
  const path = row ? `${coll}/${row.id}/revisions` : '';
  const [revs, setRevs] = useState<{ id: string; title: string; body: string; at: unknown; by: string }[] | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  if (row && loadedFor !== row.id) {
    setLoadedFor(row.id);
    void getDocs(query(collection(db(), path), orderBy('at', 'desc'), limit(20)))
      .then((s) => setRevs(s.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as { id: string; title: string; body: string; at: unknown; by: string })))
      .catch(() => setRevs([]));
  }
  return (
    <Dialog open={!!row} onClose={() => { setRevs(null); setLoadedFor(''); onClose(); }} title="Revision history" description={row?.title} size="lg">
      {!revs ? <Spinner /> : revs.length === 0 ? <EmptyState title="No revisions yet" /> : (
        <ul className="divide-y divide-line">{revs.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-muted">{fmtDate(r.at, true)} · {r.by}</p></div>
            <Button size="sm" variant="outline" onClick={() => { void patchDoc(coll, row!.id, { title: r.title, body: r.body, status: 'draft' }).then(() => { toast.success('Restored as draft'); onClose(); }).catch((e) => toast.error(errorMessage(e))); }}>Restore as draft</Button></li>))}</ul>)}
    </Dialog>
  );
}

function ContentManager({ kind }: { kind: 'pages' | 'posts' }) {
  const { role, profile } = useAuth();
  const toast = useToast();
  const [history, setHistory] = useState<Content | null>(null);
  const isPages = kind === 'pages';
  const publisher = can(role, 'cms.publish');
  const cats = useCollection<{ name: string }>(C.categories, () => [], 'all');

  const fields: FieldDef[] = [
    { name: 'title', label: 'Title', type: 'text', required: true, span: 2 },
    { name: 'slug', label: 'URL slug', type: 'text', required: true, createOnly: isPages, hint: isPages ? 'Fixed after creation. Use e.g. “about” to override a built-in page.' : 'Used in the article URL.' },
    { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: publisher ? STATUS : STATUS.slice(0, 2), hint: publisher ? undefined : 'Authors submit for review; an editor publishes.' },
    ...(isPages ? [{ name: 'summary', label: 'Summary / lead', type: 'textarea', maxLength: 400 } as FieldDef, { name: 'heroImage', label: 'Hero image', type: 'image' } as FieldDef]
      : [{ name: 'excerpt', label: 'Excerpt', type: 'textarea', maxLength: 400, required: true } as FieldDef,
         { name: 'image', label: 'Featured image', type: 'image' } as FieldDef,
         { name: 'category', label: 'Category', type: 'select', options: cats.data.map((c) => ({ value: c.name, label: c.name })) } as FieldDef,
         { name: 'tags', label: 'Tags', type: 'list', hint: 'One tag per line' } as FieldDef]),
    { name: 'body', label: 'Content', type: 'richtext', required: true },
    { name: 'seoTitle', label: 'SEO title', type: 'text', maxLength: 70 },
    { name: 'seoDescription', label: 'SEO description', type: 'textarea', maxLength: 170 },
    { name: 'ogImage', label: 'Social sharing image', type: 'image' },
  ];

  const config: CrudConfig<Content> = {
    collection: kind, singular: isPages ? 'Page' : 'Post', plural: isPages ? 'Pages' : 'Blog posts', dialogSize: 'xl', auditActions: true,
    description: isPages ? 'Pages whose slug matches a built-in page (about, philosophy, privacy-policy…) replace its default content.' : 'Articles shown on the public blog and homepage.',
    fields, searchKeys: ['title', 'slug', 'category'], sort: (a, b) => (toDate(b.updatedAt)?.getTime() ?? 0) - (toDate(a.updatedAt)?.getTime() ?? 0),
    filters: [{ name: 'status', label: 'Status', options: STATUS }], canDelete: publisher,
    columns: [
      { key: 't', header: 'Title', primary: true, cell: (r) => <span className="font-medium">{r.title}</span> },
      { key: 's', header: 'Slug', cell: (r) => <code className="text-xs">/{isPages ? r.id : (r.slug || r.id)}</code> },
      { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
      { key: 'u', header: 'Updated', cell: (r) => fmtDate(r.updatedAt) },
    ],
    idFor: isPages ? (p) => slugify(String(p.slug || p.title)) : undefined,
    beforeSave: (p, existing) => {
      if (p.status === 'published' && !publisher) throw new Error('Only editors can publish. Save as “In review”.');
      const slug = slugify(String(p.slug || p.title));
      const out: Record<string, unknown> = { ...p, slug };
      if (p.status === 'published' && !existing?.publishedAt) out.publishedAt = new Date();
      return out;
    },
    afterSave: async (id, p) => {
      await addDoc(collection(db(), `${kind}/${id}/revisions`), { title: p.title, body: p.body, status: p.status, by: profile?.displayName ?? '', at: serverTimestamp() }).catch(() => undefined);
    },
    rowActions: (r) => (
      <>
        <Link to={`/app/cms/preview/${kind}/${r.id}`} target="_blank"><Button size="icon" variant="ghost" aria-label="Preview"><Eye className="h-4 w-4" /></Button></Link>
        <Button size="icon" variant="ghost" aria-label="History" onClick={() => setHistory(r)}><History className="h-4 w-4" /></Button>
        {publisher && <Button size="icon" variant="ghost" aria-label={r.status === 'published' ? 'Unpublish' : 'Publish'}
          onClick={() => { const next = r.status === 'published' ? 'draft' : 'published'; void patchDoc(kind, r.id, { status: next, ...(next === 'published' && !r.publishedAt ? { publishedAt: new Date() } : {}) })
            .then(() => { void audit(`${kind}.${next}`, `${kind}/${r.id}`); toast.success(next === 'published' ? 'Published — live on the website' : 'Unpublished'); }).catch((e) => toast.error(errorMessage(e))); }}>
          {r.status === 'published' ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4 text-ok" />}</Button>}
      </>
    ),
  };
  return <><CrudPage key={kind + (publisher ? 'p' : 'a')} config={config} /><Revisions coll={kind} row={history} onClose={() => setHistory(null)} /></>;
}
export const CmsPages = () => <ContentManager kind="pages" />;
export const CmsPosts = () => <ContentManager kind="posts" />;

export function PreviewPage() {
  const { kind = 'pages', id = '' } = useParams();
  const { data, loading } = useDocument<Content & { summary?: string; excerpt?: string; image?: string; heroImage?: string }>(kind === 'posts' ? C.posts : C.pages, id);
  if (loading) return <Spinner />;
  if (!data) return <EmptyState title="Nothing to preview" />;
  return (
    <div>
      <div className="mb-6 rounded-md border border-gold-300 bg-gold-50 px-4 py-2 text-sm text-gold-600">Preview — status: <strong>{data.status}</strong>. {data.status !== 'published' && 'This is not visible to the public yet.'}</div>
      <Card><CardBody>{(data.heroImage || data.image) && <img src={String(data.heroImage || data.image)} alt="" className="mb-6 max-h-72 w-full rounded-md object-cover" />}
        <h1 className="text-3xl font-semibold">{data.title}</h1><p className="mt-2 text-muted">{data.summary ?? data.excerpt}</p><div className="mt-6"><Rich html={data.body} /></div></CardBody></Card>
    </div>
  );
}

/* --------------------------------------------------- simple CRUD sections */
export function CmsProgrammes() {
  const config: CrudConfig<Row & { title: string; summary: string; status: string; order?: number; image?: string }> = {
    collection: C.programmes, singular: 'Programme', plural: 'Programmes', description: 'Programme showcases on the homepage and Programmes page.', auditActions: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'order', label: 'Display order', type: 'number', min: 0 },
      { name: 'summary', label: 'Summary', type: 'textarea', required: true, maxLength: 400 }, { name: 'image', label: 'Image', type: 'image' },
      { name: 'link', label: 'Link (e.g. /islamic-education)', type: 'text' }, { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'published', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    ],
    columns: [{ key: 't', header: 'Programme', primary: true, cell: (r) => <span className="font-medium">{r.title}</span> }, { key: 'o', header: 'Order', cell: (r) => r.order ?? '—' }, { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> }],
    searchKeys: ['title', 'summary'], sort: (a, b) => (a.order ?? 99) - (b.order ?? 99),
  };
  return <CrudPage config={config} />;
}

export function CmsCategories() {
  return <CrudPage config={{
    collection: C.categories, singular: 'Category', plural: 'Categories', description: 'Blog categories.', auditActions: true,
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true }, { name: 'description', label: 'Description', type: 'textarea' }],
    columns: [{ key: 'n', header: 'Name', primary: true, cell: (r: Row & { name: string }) => <span className="font-medium">{r.name}</span> }, { key: 'd', header: 'Description', cell: (r: Row & { description?: string }) => r.description ?? '' }],
    searchKeys: ['name'],
  } as CrudConfig<Row & { name: string }>} />;
}

export function CmsAnnouncements() {
  return <CrudPage config={{
    collection: C.announcements, singular: 'Announcement', plural: 'Announcements', description: 'Public notices appear on the homepage; portal notices only to signed-in users.', auditActions: true,
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true }, { name: 'body', label: 'Message', type: 'textarea', required: true },
      { name: 'audience', label: 'Audience', type: 'select', required: true, defaultValue: 'public', options: [{ value: 'public', label: 'Public website + portal' }, { value: 'portal', label: 'Signed-in users only' }] },
      { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    ],
    columns: [{ key: 't', header: 'Title', primary: true, cell: (r: Row & { title: string }) => <span className="font-medium">{r.title}</span> }, { key: 'a', header: 'Audience', cell: (r: Row & { audience?: string }) => r.audience }, { key: 's', header: 'Status', cell: (r: Row & { status: string }) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Created', cell: (r: Row) => fmtDate(r.createdAt) }],
    searchKeys: ['title', 'body'], sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    beforeSave: (p) => (p.status === 'published' ? { ...p, publishedAt: new Date() } : p),
  } as CrudConfig<Row & { title: string }>} />;
}

export function CmsSpotlight() {
  const T = (v: string, l: string) => ({ value: v, label: l });
  return <CrudPage config={{
    collection: C.socialPosts, singular: 'Spotlight post', plural: 'Social Spotlight', description: 'Posts shown in “From the ELA Community” on the homepage and /spotlight. Videos are links only (YouTube, Vimeo, Google Drive or a direct .mp4/.webm file) and load only when a visitor taps play.', auditActions: true, canDelete: true,
    fields: [
      { name: 'type', label: 'Post type', type: 'select', required: true, defaultValue: 'image', options: [T('image', 'Image'), T('video', 'Video'), T('text', 'Text')] },
      { name: 'title', label: 'Title', type: 'text', required: true, maxLength: 140 },
      { name: 'caption', label: 'Short caption', type: 'textarea', maxLength: 300, hint: 'Shown on the card and under the post.' },
      { name: 'imageUrl', label: 'Picture (image posts)', type: 'image' },
      { name: 'thumbnailUrl', label: 'Custom thumbnail (recommended for videos)', type: 'image' },
      { name: 'videoUrl', label: 'Video link (video posts)', type: 'url', hint: 'YouTube (unlisted is fine), Vimeo, Google Drive file link, or direct https .mp4/.webm.' },
      { name: 'body', label: 'Full text (optional for image/video, required for text posts)', type: 'richtext' },
      { name: 'publishedAt', label: 'Publication date', type: 'datetime', hint: 'A future date keeps the post hidden until then.' },
      { name: 'order', label: 'Display order (1 = first)', type: 'number', min: 0 },
      { name: 'featured', label: 'Feature this post (shown first)', type: 'checkbox' },
      { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: [{ value: 'draft', label: 'Draft (hidden)' }, { value: 'published', label: 'Published' }] },
    ],
    columns: [{ key: 't', header: 'Title', primary: true, cell: (r: Row & { title: string }) => <span className="font-medium">{r.title}</span> }, { key: 'ty', header: 'Type', cell: (r: Row & { type?: string }) => r.type }, { key: 'f', header: 'Featured', cell: (r: Row & { featured?: boolean }) => (r.featured ? 'Yes' : '') }, { key: 's', header: 'Status', cell: (r: Row & { status: string }) => <StatusBadge status={r.status} /> }],
    searchKeys: ['title', 'caption'],
    sort: (a, b) => (Number(!!b.featured) - Number(!!a.featured)) || ((a.order as number ?? 999) - (b.order as number ?? 999)) || ((toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0)),
    beforeSave: (p) => {
      const r = spotlightSchema.safeParse(p);
      if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join(' '));
      return p.status === 'published' && !p.publishedAt ? { ...p, publishedAt: new Date() } : p;
    },
  } as CrudConfig<Row & { title: string }>} />;
}

export function CmsIslamic() {
  const T = (v: string, l: string) => ({ value: v, label: l });
  return <CrudPage config={{
    collection: C.islamicContent, singular: 'Islamic item', plural: 'Islamic content', description: 'Everything on the public /islamic page and /community page that is not fetched live: khutbahs, videos, news, pictures, social posts, Tajweed lessons, extra hadith and adhkar. Always give a source for religious text.', auditActions: true,
    fields: [
      { name: 'type', label: 'Section', type: 'select', required: true, defaultValue: 'news', options: [T('news', 'Islamic news / update'), T('khutbah', 'Friday khutbah'), T('video', 'Video (admonition, lecture)'), T('gallery', 'Picture (dashboard slider)'), T('tajweed', 'Tajweed lesson'), T('hadith', 'Hadith'), T('adhkar', 'Adhkar / dua')] },
      { name: 'title', label: 'Title / caption', type: 'text', required: true },
      { name: 'itemDate', label: 'Date (khutbah date, news date)', type: 'date' },
      { name: 'arabic', label: 'Arabic text (khutbah, hadith, dua)', type: 'textarea' },
      { name: 'body', label: 'English text / translation / summary', type: 'textarea' },
      { name: 'source', label: 'Source (author, collection, outlet, grading)', type: 'text' },
      { name: 'imageUrl', label: 'Picture (gallery, social posts)', type: 'image' },
      { name: 'videoUrl', label: 'YouTube link (videos, khutbah video, social)', type: 'url', hint: 'Paste the normal YouTube address. It is embedded on the page.' },
      { name: 'audioUrl', label: 'Audio file link (khutbah audio, .mp3)', type: 'url', hint: 'A direct link to an audio file (for example an uploaded Cloudinary or Supabase public link).' },
      { name: 'link', label: 'Link to original (news report, social post)', type: 'url' },
      { name: 'platform', label: 'Platform (social posts)', type: 'select', options: [T('youtube', 'YouTube'), T('facebook', 'Facebook'), T('instagram', 'Instagram'), T('x', 'X'), T('tiktok', 'TikTok'), T('other', 'Other')] },
      { name: 'status', label: 'Status', type: 'select', required: true, defaultValue: 'draft', options: [{ value: 'draft', label: 'Draft' }, { value: 'published', label: 'Published' }] },
    ],
    columns: [{ key: 't', header: 'Title', primary: true, cell: (r: Row & { title: string }) => <span className="font-medium">{r.title}</span> }, { key: 'ty', header: 'Section', cell: (r: Row & { type?: string }) => r.type }, { key: 's', header: 'Status', cell: (r: Row & { status: string }) => <StatusBadge status={r.status} /> }],
    searchKeys: ['title', 'body'], sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
  } as CrudConfig<Row & { title: string }>} />;
}

/* ------------------------------------------------------- settings editors */
export function SettingsForm({ id, title, description, fields, defaults }: { id: string; title: string; description: string; fields: FieldDef[]; defaults: Record<string, unknown> }) {
  const toast = useToast();
  const cfg = useSettings<Record<string, unknown>>(id, defaults);
  if (!cfg.__loaded) return <Spinner />;
  const { __loaded, ...initial } = cfg;
  void __loaded;
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card className="max-w-3xl"><CardBody>
        <EntityForm fields={fields} initial={initial} submitLabel="Save and publish"
          onSubmit={async (p) => { try { await setDoc(doc(db(), C.settings, id), { ...p, updatedAt: serverTimestamp() }, { merge: true }); void audit('settings.update', `settings/${id}`); toast.success('Saved — the website now uses these settings'); } catch (e) { toast.error(errorMessage(e)); } }} />
      </CardBody></Card>
    </>
  );
}

export const CmsHomepage = () => <SettingsForm id="home" title="Homepage & hero" description="Hero headline, image, buttons and introduction on the public homepage."
  defaults={{ heroTitle: 'Building Minds, Shaping Character', heroSubtitle: 'Quality education rooted in knowledge, values, and purpose.', heroImage: '', ctaLabel: 'Apply for admission', ctaLink: '/admissions', secondaryLabel: 'Explore programmes', secondaryLink: '/programmes', introTitle: 'Who we are', introText: '' }}
  fields={[
    { name: 'heroTitle', label: 'Hero title', type: 'text', required: true, span: 2 }, { name: 'heroSubtitle', label: 'Hero subtitle', type: 'textarea' }, { name: 'heroImage', label: 'Hero image', type: 'image', hint: 'Leave empty to use the built-in poster.' },
    { name: 'ctaLabel', label: 'Primary button label', type: 'text' }, { name: 'ctaLink', label: 'Primary button link', type: 'text' }, { name: 'secondaryLabel', label: 'Secondary button label', type: 'text' }, { name: 'secondaryLink', label: 'Secondary button link', type: 'text' },
    { name: 'introTitle', label: 'Intro eyebrow', type: 'text' }, { name: 'introText', label: 'Intro paragraph', type: 'textarea' }]} />;

export const CmsNavigation = () => <SettingsForm id="navigation" title="Navigation" description="Header menu. One item per line as  Label | /path  — leave empty for the default menu."
  defaults={{ items: DEFAULT_NAV.map((n) => `${n.label} | ${n.to}`) }}
  fields={[{ name: 'items', label: 'Menu items', type: 'list', placeholder: 'About | /about' }]} />;

export const CmsSettings = () => <SettingsForm id="site" title="Website settings" description="Branding, contact details and social links. The logo file itself lives in public/brand/logo.png (see README)."
  defaults={{ ...SITE_DEFAULTS, phones: SITE_DEFAULTS.phones }}
  fields={[
    { name: 'name', label: 'Organisation name', type: 'text', required: true }, { name: 'tagline', label: 'Tagline / motto', type: 'text' },
    { name: 'logo', label: 'Logo override (optional)', type: 'image', hint: 'Empty = use public/brand/logo.png' },
    { name: 'email', label: 'Email', type: 'email' }, { name: 'phones', label: 'Phone numbers', type: 'list' }, { name: 'address', label: 'Location', type: 'text' }, { name: 'whatsapp', label: 'WhatsApp number (international, no +)', type: 'text' },
    { name: 'facebook', label: 'Facebook URL', type: 'url' }, { name: 'instagram', label: 'Instagram URL', type: 'url' }, { name: 'youtube', label: 'YouTube URL', type: 'url' }, { name: 'tiktok', label: 'TikTok URL', type: 'url' },
    { name: 'footerText', label: 'Footer text', type: 'textarea' }]} />;

/* media library lives in src/features/media/MediaLibrary.tsx */
export { MediaLibrary as CmsMedia } from '@/features/media/MediaLibrary';

/* ---------------------------------------------------------- enquiries */
export function CmsEnquiries() {
  return <CrudPage config={{
    collection: C.contactEnquiries, singular: 'Enquiry', plural: 'Contact enquiries', description: 'Messages sent through the website contact form.', canCreate: false, canEdit: true, auditActions: true,
    fields: [{ name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'new', label: 'New' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }] }, { name: 'internalNote', label: 'Internal note', type: 'textarea' }],
    columns: [
      { key: 'n', header: 'From', primary: true, cell: (r: Row & { name: string; email: string }) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.email}</p></div> },
      { key: 'm', header: 'Message', cell: (r: Row & { subject?: string; message: string }) => <div className="max-w-md"><p className="text-xs font-medium">{r.subject}</p><p className="line-clamp-3 text-[13px]">{r.message}</p></div> },
      { key: 'p', header: 'Phone', cell: (r: Row & { phone?: string }) => r.phone || '—' }, { key: 's', header: 'Status', cell: (r: Row & { status: string }) => <StatusBadge status={r.status} /> }, { key: 'd', header: 'Received', cell: (r: Row) => fmtDate(r.createdAt, true) },
    ],
    searchKeys: ['name', 'email', 'subject', 'message'], filters: [{ name: 'status', label: 'Status', options: [{ value: 'new', label: 'New' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }] }],
    sort: (a, b) => (toDate(b.createdAt)?.getTime() ?? 0) - (toDate(a.createdAt)?.getTime() ?? 0),
    exportColumns: [{ header: 'Name', value: (r: Row & { name?: string }) => r.name }, { header: 'Email', value: (r: Row & { email?: string }) => r.email }, { header: 'Message', value: (r: Row & { message?: string }) => r.message }],
    canDelete: false,
  } as CrudConfig<Row>} />;
}

/* ----------------------------------------------------------- overview */
export function CmsOverview() {
  const toast = useToast();
  const pages = useCollection<{ status: string }>(C.pages, () => [], 'all');
  const posts = useCollection<{ status: string }>(C.posts, () => [], 'all');
  const enq = useCollection<{ status: string }>(C.contactEnquiries, () => [where('status', '==', 'new')], 'new');
  const [importing, setImporting] = useState(false);
  const importLegacy = async () => {
    setImporting(true);
    try {
      for (const p of legacyPosts as { title: string; excerpt: string; image: string; body: string }[]) {
        await createDoc(C.posts, { title: p.title, slug: slugify(p.title), excerpt: p.excerpt, body: p.body, image: `${import.meta.env.BASE_URL}${p.image}`, category: 'Education', tags: [], status: 'draft' });
      }
      toast.success('Imported 3 original blog posts as drafts');
    } catch (e) { toast.error(errorMessage(e)); } finally { setImporting(false); }
  };
  const pub = (l: { status: string }[]) => l.filter((x) => x.status === 'published').length;
  return (
    <>
      <PageHeader title="Content overview" description="Everything here is stored in Firestore and appears on the public site when published." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pages" value={pages.data.length} hint={`${pub(pages.data)} published`} /><StatCard label="Blog posts" value={posts.data.length} hint={`${pub(posts.data)} published`} tone="gold" />
        <StatCard label="New enquiries" value={enq.data.length} tone={enq.data.length ? 'danger' : 'ok'} /><StatCard label="Drafts / review" value={pages.data.length + posts.data.length - pub(pages.data) - pub(posts.data)} />
      </div>
      <Card className="mt-6"><CardHeader title="Quick actions" /><CardBody className="flex flex-wrap gap-2">
        <Link to="/app/cms/pages"><Button variant="outline">Manage pages</Button></Link><Link to="/app/cms/posts"><Button variant="outline">Write a post</Button></Link><Link to="/app/cms/homepage"><Button variant="outline">Edit homepage</Button></Link>
        {posts.data.length === 0 && <Button variant="gold" loading={importing} onClick={() => void importLegacy()}>Import original blog posts (as drafts)</Button>}</CardBody></Card>
    </>
  );
}
