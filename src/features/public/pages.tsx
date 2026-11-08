import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { addDoc, collection, serverTimestamp, where } from 'firebase/firestore';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, BookOpen, CheckCircle2, Search as SearchIcon } from 'lucide-react';
import { BRAND, IMAGES, whatsappLink } from '@/config/brand';
import { db } from '@/config/firebase';
import { C } from '@/config/collections';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card } from '@/components/ui/card';
import { EmptyState, Spinner } from '@/components/ui/data';
import { useSettings } from '@/hooks/useSettings';
import { useCollection } from '@/hooks/useFirestore';
import { useSeo } from '@/hooks/useSeo';
import { subscribeDoc, getById } from '@/services/db';
import { sanitizeHtml, stripHtml } from '@/lib/sanitize';
import { errorMessage, fmtDate, toDate } from '@/lib/utils';
import { CLASS_LEVELS, DEFAULT_FAQ, DEFAULT_PAGES, DEFAULT_PROGRAMMES, PROGRAMME_CHOICES } from './content';
import { useSite } from './PublicLayout';
import type { Course } from '@/types/models';

interface CmsPage { title: string; summary?: string; body: string; heroImage?: string; seoTitle?: string; seoDescription?: string; ogImage?: string; status: string }
interface Programme { title: string; summary: string; image?: string; link?: string; status: string; order?: number }
interface Post { title: string; slug: string; excerpt: string; body: string; image?: string; category?: string; tags?: string[]; status: string; publishedAt?: unknown; seoDescription?: string; ogImage?: string }
interface Announcement { title: string; body: string; status: string; audience: string; publishedAt?: unknown }
interface HomeCfg { heroTitle: string; heroSubtitle: string; heroImage: string; ctaLabel: string; ctaLink: string; secondaryLabel: string; secondaryLink: string; introTitle: string; introText: string }
const HOME_DEFAULTS: HomeCfg = {
  heroTitle: 'Building Minds, Shaping Character',
  heroSubtitle: 'Quality education rooted in knowledge, values, and purpose — academic, Islamic and digital-skills learning in Ilorin, Nigeria.',
  heroImage: IMAGES.hero, ctaLabel: 'Apply for admission', ctaLink: '/admissions', secondaryLabel: 'Explore programmes', secondaryLink: '/programmes',
  introTitle: 'Who we are',
  introText: 'Episteme Learning Academy is a learning community built on the belief that true education goes beyond textbooks. We nurture the mind, refine character, and guide learners toward purposeful living.',
};

export function Rich({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return <div className="prose-ela" dangerouslySetInnerHTML={{ __html: clean }} />;
}

function Section({ children, tone = 'white', className = '' }: { children: React.ReactNode; tone?: 'white' | 'cream' | 'forest'; className?: string }) {
  const bg = { white: 'bg-white', cream: 'bg-cream', forest: 'bg-forest-700 text-white' }[tone];
  return <section className={`${bg} ${className}`}><div className="mx-auto max-w-7xl px-4 py-16 md:px-6 md:py-20">{children}</div></section>;
}
const Eyebrow = ({ children }: { children: React.ReactNode }) => <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-gold-500">{children}</p>;

/* ------------------------------------------------------------------- HOME */
export function HomePage() {
  const home = useSettings<HomeCfg>('home', HOME_DEFAULTS);
  const site = useSite();
  useSeo(undefined, home.heroSubtitle, home.heroImage);
  const progs = useCollection<Programme>(C.programmes, () => [where('status', '==', 'published')], 'pub');
  const news = useCollection<Announcement>(C.announcements, () => [where('status', '==', 'published'), where('audience', '==', 'public')], 'pub-public');
  const posts = useCollection<Post>(C.posts, () => [where('status', '==', 'published')], 'pub');
  const courses = useCollection<Course>(C.courses, () => [where('visibility', '==', 'public'), where('status', '==', 'published')], 'public');
  const programmes = progs.data.length ? [...progs.data].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((p) => ({ slug: p.id, title: p.title, summary: p.summary, image: p.image ?? '', link: p.link ?? `/programmes#${p.id}` })) : DEFAULT_PROGRAMMES;
  const latest = [...posts.data].sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0)).slice(0, 3);
  const announcements = [...news.data].sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0)).slice(0, 3);

  return (
    <>
      <section className="relative overflow-hidden bg-forest-700 text-white">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 md:px-6 md:py-20 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Eyebrow>{site.tagline}</Eyebrow>
            <h1 className="text-4xl font-semibold !text-white md:text-5xl lg:text-[3.4rem]">{home.heroTitle}</h1>
            <p className="mt-5 max-w-xl text-lg text-forest-100">{home.heroSubtitle}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={home.ctaLink}><Button variant="gold" size="lg">{home.ctaLabel} <ArrowRight className="h-4 w-4" /></Button></Link>
              <Link to={home.secondaryLink}><Button size="lg" className="border border-white/30 bg-transparent text-white hover:bg-white/10">{home.secondaryLabel}</Button></Link>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-forest-200">{BRAND.philosophy.map((p) => <li key={p} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-gold-400" />{p}</li>)}</ul>
          </div>
          <div className="mx-auto w-full max-w-sm lg:max-w-md">
            <img src={home.heroImage} alt="Episteme Learning Academy — Building Minds, Shaping Character" className="w-full rounded-lg shadow-pop ring-4 ring-white/10" fetchPriority="high" />
          </div>
        </div>
      </section>

      <Section>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <img src={IMAGES.classroom} alt="Learners in an Episteme classroom" className="rounded-lg shadow-card" loading="lazy" />
          <div><Eyebrow>{home.introTitle}</Eyebrow><h2 className="text-3xl font-semibold">Balanced education for mind and character</h2>
            <p className="mt-4 text-muted">{home.introText}</p>
            <ul className="mt-6 space-y-2 text-sm">{['Small, focused learning groups', 'Physical, online and hybrid options', 'Personalised mentorship', 'Modern digital skills training'].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold-500" />{t}</li>)}</ul>
            <Link to="/about" className="mt-6 inline-flex items-center gap-1 font-medium text-forest-500 underline underline-offset-4">About ELA <ArrowRight className="h-4 w-4" /></Link></div>
        </div>
      </Section>

      <Section tone="cream">
        <Eyebrow>Academic programmes</Eyebrow><h2 className="text-3xl font-semibold">What we teach</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {programmes.slice(0, 8).map((p) => (
            <Link key={p.slug} to={p.link} className="group overflow-hidden rounded-lg border border-line bg-white shadow-card transition-shadow hover:shadow-pop">
              {p.image && <img src={p.image} alt="" className="aspect-[16/10] w-full object-cover" loading="lazy" />}
              <div className="p-5"><h3 className="text-[15px] font-semibold">{p.title}</h3><p className="mt-1.5 text-[13.5px] text-muted">{p.summary}</p></div>
            </Link>
          ))}
        </div>
      </Section>

      {courses.data.length > 0 && (
        <Section>
          <Eyebrow>Featured learning resources</Eyebrow><h2 className="text-3xl font-semibold">Open courses</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {courses.data.slice(0, 3).map((c) => (
              <Link key={c.id} to="/resources" className="flex gap-4 rounded-lg border border-line p-4 hover:border-gold-300"><BookOpen className="h-5 w-5 shrink-0 text-gold-500" /><div><p className="font-medium">{c.title}</p><p className="text-sm text-muted line-clamp-2">{c.description}</p></div></Link>
            ))}
          </div>
        </Section>
      )}

      {(announcements.length > 0 || latest.length > 0) && (
        <Section tone="cream">
          <div className="grid gap-10 lg:grid-cols-2">
            {announcements.length > 0 && <div><Eyebrow>Announcements</Eyebrow><h2 className="text-2xl font-semibold">Latest news</h2>
              <ul className="mt-5 space-y-4">{announcements.map((a) => <li key={a.id} className="rounded-lg border border-line bg-white p-4"><p className="font-medium">{a.title}</p><p className="mt-1 text-sm text-muted">{a.body}</p><p className="mt-2 text-xs text-muted">{fmtDate(a.publishedAt)}</p></li>)}</ul></div>}
            {latest.length > 0 && <div><Eyebrow>From the blog</Eyebrow><h2 className="text-2xl font-semibold">Insights</h2>
              <ul className="mt-5 space-y-4">{latest.map((p) => <li key={p.id}><Link to={`/blog/${p.slug || p.id}`} className="block rounded-lg border border-line bg-white p-4 hover:border-gold-300"><p className="font-medium">{p.title}</p><p className="mt-1 text-sm text-muted line-clamp-2">{p.excerpt}</p></Link></li>)}</ul></div>}
          </div>
        </Section>
      )}

      <Section tone="forest">
        <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
          <div><h2 className="text-3xl font-semibold !text-white">Admissions are open</h2><p className="mt-2 max-w-xl text-forest-100">Give your child a balanced education that nurtures knowledge, character and confidence.</p></div>
          <div className="flex gap-3"><Link to="/admissions"><Button variant="gold" size="lg">Apply now</Button></Link>
            <a href={whatsappLink('Hello, I would like to enquire about admission.')} target="_blank" rel="noopener noreferrer"><Button size="lg" className="border border-white/30 bg-transparent text-white hover:bg-white/10">WhatsApp us</Button></a></div>
        </div>
      </Section>
    </>
  );
}

/* ------------------------------------------------ CMS-managed content page */
export function PageHero({ title, lead, image }: { title: string; lead?: string; image?: string }) {
  return (
    <section className="bg-forest-700 text-white">
      <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 md:px-6 md:py-16 lg:grid-cols-[1.3fr_1fr]">
        <div><h1 className="text-3xl font-semibold !text-white md:text-4xl">{title}</h1>{lead && <p className="mt-3 max-w-xl text-lg text-forest-100">{lead}</p>}</div>
        {image && <img src={image} alt="" className="hidden max-h-64 w-full rounded-lg object-cover lg:block" />}
      </div>
    </section>
  );
}

export function ContentPage({ slug }: { slug: string }) {
  const def = DEFAULT_PAGES.find((p) => p.slug === slug);
  const [cms, setCms] = useState<CmsPage | null | undefined>(undefined);
  useEffect(() => {
    setCms(undefined);
    return subscribeDoc<CmsPage>(C.pages, slug, (d) => setCms(d && d.status === 'published' ? d : null), () => setCms(null));
  }, [slug]);
  const title = cms?.title ?? def?.title ?? 'Page not found';
  useSeo(cms?.seoTitle || title, cms?.seoDescription || cms?.summary || def?.lead, cms?.ogImage || cms?.heroImage || def?.image);
  if (cms === undefined) return <Spinner className="min-h-[50vh]" />;
  if (!cms && !def) return <NotFound />;
  return (
    <>
      <PageHero title={title} lead={cms?.summary ?? def?.lead} image={cms?.heroImage || def?.image} />
      <div className="mx-auto max-w-3xl px-4 py-14 md:px-6"><Rich html={cms?.body ?? def?.body ?? ''} />
        <div className="mt-10"><Link to="/admissions"><Button variant="gold">Enquire about admission</Button></Link></div></div>
    </>
  );
}

/** Slugs used by the router; every one is overridable from the CMS. */
export const PAGE_SLUGS = DEFAULT_PAGES.map((p) => p.slug);

/* ------------------------------------------------------------ PROGRAMMES */
export function ProgrammesPage() {
  useSeo('Academic Programmes', 'Academic, Islamic, ICT, coding and skills programmes at Episteme Learning Academy.');
  const { data, loading } = useCollection<Programme>(C.programmes, () => [where('status', '==', 'published')], 'pub');
  const list = data.length ? [...data].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map((p) => ({ slug: p.id, title: p.title, summary: p.summary, image: p.image ?? '', link: p.link ?? '' })) : DEFAULT_PROGRAMMES;
  return (
    <>
      <PageHero title="Academic Programmes" lead="From early years to senior secondary, Islamic education and digital skills." image={IMAGES.curriculum} />
      <Section>{loading ? <Spinner /> : (
        <div className="grid gap-6 md:grid-cols-2">
          {list.map((p) => (
            <article key={p.slug} id={p.slug} className="flex flex-col overflow-hidden rounded-lg border border-line shadow-card sm:flex-row">
              {p.image && <img src={p.image} alt="" className="h-44 w-full object-cover sm:h-auto sm:w-44" loading="lazy" />}
              <div className="p-5"><h2 className="text-lg font-semibold">{p.title}</h2><p className="mt-2 text-sm text-muted">{p.summary}</p>
                {p.link && <Link to={p.link} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-forest-500 underline underline-offset-4">Learn more <ArrowRight className="h-4 w-4" /></Link>}</div>
            </article>
          ))}
        </div>)}</Section>
    </>
  );
}

/* ------------------------------------------------------------------ BLOG */
export function BlogPage() {
  useSeo('Blog & News', 'Insights on education, character development, flexible learning and raising purpose-driven learners.');
  const { data, loading, error } = useCollection<Post>(C.posts, () => [where('status', '==', 'published')], 'pub');
  const posts = [...data].sort((a, b) => (toDate(b.publishedAt)?.getTime() ?? 0) - (toDate(a.publishedAt)?.getTime() ?? 0));
  return (
    <>
      <PageHero title="Blog & News" lead="Insights on education, character and flexible learning." image={IMAGES.holistic} />
      <Section>{loading ? <Spinner /> : error || posts.length === 0 ? (
        <EmptyState title="No articles published yet" description="Check back soon — new posts are published from the school CMS." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <Link key={p.id} to={`/blog/${p.slug || p.id}`} className="overflow-hidden rounded-lg border border-line bg-white shadow-card transition-shadow hover:shadow-pop">
              {p.image && <img src={p.image} alt="" className="aspect-[16/10] w-full object-cover" loading="lazy" />}
              <div className="p-5"><p className="text-xs text-muted">{p.category} {p.category ? '·' : ''} {fmtDate(p.publishedAt)}</p><h2 className="mt-1 text-lg font-semibold">{p.title}</h2><p className="mt-2 text-sm text-muted line-clamp-3">{p.excerpt}</p></div>
            </Link>
          ))}
        </div>)}</Section>
    </>
  );
}

export function BlogPostPage() {
  const { slug = '' } = useParams();
  const { data, loading } = useCollection<Post>(C.posts, () => [where('status', '==', 'published')], 'pub');
  const post = data.find((p) => p.slug === slug || p.id === slug);
  useSeo(post?.title, post?.seoDescription || post?.excerpt, post?.ogImage || post?.image);
  if (loading) return <Spinner className="min-h-[50vh]" />;
  if (!post) return <NotFound />;
  return (
    <article>
      <PageHero title={post.title} lead={post.excerpt} image={post.image} />
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-6"><p className="mb-6 text-sm text-muted">{fmtDate(post.publishedAt)} {post.category ? `· ${post.category}` : ''}</p><Rich html={post.body} />
        <Link to="/blog" className="mt-10 inline-block font-medium text-forest-500 underline underline-offset-4">← All articles</Link></div>
    </article>
  );
}

/* --------------------------------------------------------------- CONTACT */
const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(120),
  email: z.string().trim().email('Enter a valid email').max(160),
  phone: z.string().trim().max(40).optional(),
  subject: z.string().trim().max(160).optional(),
  message: z.string().trim().min(5, 'Message is too short').max(4000),
  website: z.string().max(0).optional(), // honeypot
});
type ContactValues = z.infer<typeof contactSchema>;

export function ContactPage() {
  useSeo('Contact', 'Contact Episteme Learning Academy in Ilorin, Kwara State.');
  const site = useSite();
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ContactValues>({ resolver: zodResolver(contactSchema) });
  const submit = handleSubmit(async (v) => {
    setErr('');
    if (v.website) { setSent(true); return; } // bot
    try {
      await addDoc(collection(db(), C.contactEnquiries), { name: v.name, email: v.email, phone: v.phone ?? '', subject: v.subject ?? '', message: v.message, status: 'new', createdAt: serverTimestamp() });
      setSent(true); reset();
    } catch (e) { setErr(errorMessage(e)); }
  });
  return (
    <>
      <PageHero title="Contact us" lead="We usually respond within one working day." image={IMAGES.consultation} />
      <Section><div className="grid gap-10 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4 text-sm"><h2 className="text-xl font-semibold">Get in touch</h2>
          <p>{site.address}</p><p><a className="text-forest-500 underline" href={`mailto:${site.email}`}>{site.email}</a></p>
          <p>{site.phones.map((p) => <a key={p} className="mr-3 text-forest-500 underline" href={`tel:${p}`}>{p}</a>)}</p>
          <a href={whatsappLink('Hello Episteme Learning Academy')} target="_blank" rel="noopener noreferrer"><Button variant="outline"><img src={IMAGES.icons.whatsapp} alt="" className="h-5 w-5" />Chat on WhatsApp</Button></a></div>
        <Card className="p-6">{sent ? (
          <div role="status" className="py-8 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-ok" /><h2 className="mt-3 text-lg font-semibold">Message sent</h2><p className="mt-1 text-sm text-muted">Thank you. We will get back to you shortly.</p><Button className="mt-4" variant="outline" onClick={() => setSent(false)}>Send another</Button></div>
        ) : (
          <form onSubmit={(e) => { void submit(e); }} noValidate className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" required error={errors.name?.message}>{(a) => <Input {...a} autoComplete="name" {...register('name')} />}</Field>
            <Field label="Email" required error={errors.email?.message}>{(a) => <Input {...a} type="email" autoComplete="email" {...register('email')} />}</Field>
            <Field label="Phone / WhatsApp" error={errors.phone?.message}>{(a) => <Input {...a} type="tel" autoComplete="tel" {...register('phone')} />}</Field>
            <Field label="Subject" error={errors.subject?.message}>{(a) => <Input {...a} {...register('subject')} />}</Field>
            <Field label="Message" required error={errors.message?.message} className="sm:col-span-2">{(a) => <Textarea {...a} rows={5} {...register('message')} />}</Field>
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" {...register('website')} />
            {err && <p role="alert" className="text-sm text-danger sm:col-span-2">{err}</p>}
            <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting}>Send message</Button></div>
          </form>)}</Card>
      </div></Section>
    </>
  );
}

/* ------------------------------------------------------------ ADMISSIONS */
const admSchema = z.object({
  studentName: z.string().trim().min(2, 'Enter the learner’s name').max(160),
  gender: z.string().optional(), dob: z.string().optional(),
  classApplied: z.string().min(1, 'Select a class'),
  mode: z.string().optional(), schedule: z.string().optional(),
  parentName: z.string().trim().min(2, 'Enter parent/guardian name').max(160),
  parentPhone: z.string().trim().min(7, 'Enter a valid phone number').max(40),
  parentEmail: z.string().trim().email('Enter a valid email').or(z.literal('')).optional(),
  address: z.string().trim().max(300).optional(), notes: z.string().trim().max(3000).optional(),
  programmes: z.array(z.string()).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Please confirm the declaration' }) }),
});
type AdmValues = z.infer<typeof admSchema>;

export function AdmissionsPage() {
  useSeo('Admissions', 'Apply or enquire about admission at Episteme Learning Academy.');
  const [done, setDone] = useState<AdmValues | null>(null);
  const [err, setErr] = useState('');
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<AdmValues>({ resolver: zodResolver(admSchema), defaultValues: { programmes: [] } });
  const submit = handleSubmit(async (v) => {
    setErr('');
    try {
      await addDoc(collection(db(), C.admissionEnquiries), {
        studentName: v.studentName, gender: v.gender ?? '', dob: v.dob ?? '', classApplied: v.classApplied, programmes: v.programmes ?? [], mode: v.mode ?? '', schedule: v.schedule ?? '',
        parentName: v.parentName, parentEmail: v.parentEmail ?? '', parentPhone: v.parentPhone, whatsapp: v.parentPhone, address: v.address ?? '', notes: v.notes ?? '',
        consent: true, status: 'new', createdAt: serverTimestamp(),
      });
      setDone(v);
    } catch (e) { setErr(errorMessage(e)); }
  });
  if (done) return (
    <><PageHero title="Admissions" image={IMAGES.classroom} /><Section><div role="status" className="mx-auto max-w-lg text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-ok" />
      <h2 className="mt-3 text-2xl font-semibold">Enquiry received</h2><p className="mt-2 text-muted">Thank you, {done.parentName}. Our admissions team will contact you on {done.parentPhone}.</p>
      <a className="mt-5 inline-block" href={whatsappLink(`Hello, I just submitted an admission enquiry for ${done.studentName} (${done.classApplied}).`)} target="_blank" rel="noopener noreferrer"><Button variant="gold">Also message us on WhatsApp</Button></a></div></Section></>
  );
  return (
    <>
      <PageHero title="Admissions" lead="Tell us about your child and we will guide you through the next steps." image={IMAGES.classroom} />
      <Section><form onSubmit={(e) => { void submit(e); }} noValidate className="mx-auto max-w-3xl space-y-8">
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-heading text-lg font-semibold text-forest-700">Learner</legend>
          <Field label="Full name" required error={errors.studentName?.message}>{(a) => <Input {...a} {...register('studentName')} />}</Field>
          <Field label="Class applying for" required error={errors.classApplied?.message}>{(a) => <Select {...a} {...register('classApplied')}><option value="">Select…</option>{CLASS_LEVELS.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
          <Field label="Gender">{(a) => <Select {...a} {...register('gender')}><option value="">Select…</option><option>Male</option><option>Female</option></Select>}</Field>
          <Field label="Date of birth">{(a) => <Input {...a} type="date" {...register('dob')} />}</Field>
          <Field label="Class mode">{(a) => <Select {...a} {...register('mode')}><option value="">No preference</option><option>On-site</option><option>Online</option><option>Hybrid</option></Select>}</Field>
          <Field label="Preferred schedule">{(a) => <Select {...a} {...register('schedule')}><option value="">Flexible</option><option>Morning</option><option>Afternoon</option><option>Evening</option></Select>}</Field></fieldset>
        <fieldset><legend className="mb-3 font-heading text-lg font-semibold text-forest-700">Programmes of interest</legend>
          <div className="grid gap-2 sm:grid-cols-2">{PROGRAMME_CHOICES.map((p) => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" value={p} className="h-4 w-4 accent-forest-700" {...register('programmes')} />{p}</label>)}</div></fieldset>
        <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-heading text-lg font-semibold text-forest-700">Parent / guardian</legend>
          <Field label="Full name" required error={errors.parentName?.message}>{(a) => <Input {...a} {...register('parentName')} />}</Field>
          <Field label="Phone / WhatsApp" required error={errors.parentPhone?.message}>{(a) => <Input {...a} type="tel" {...register('parentPhone')} />}</Field>
          <Field label="Email" error={errors.parentEmail?.message}>{(a) => <Input {...a} type="email" {...register('parentEmail')} />}</Field>
          <Field label="Home address">{(a) => <Input {...a} {...register('address')} />}</Field>
          <Field label="Anything else we should know?" className="sm:col-span-2">{(a) => <Textarea {...a} {...register('notes')} />}</Field></fieldset>
        <div><Checkbox label="I certify that the information provided is true and accurate, and I agree to the academy’s terms, including its refund and cancellation policy." {...register('consent')} />
          {errors.consent && <p role="alert" className="mt-1 text-xs text-danger">{errors.consent.message}</p>}</div>
        {err && <p role="alert" className="text-sm text-danger">{err}</p>}
        <Button type="submit" size="lg" loading={isSubmitting}>Submit enquiry</Button>
      </form></Section>
    </>
  );
}

/* ------------------------------------------------------------- FAQ / etc */
export function FaqPage() {
  useSeo('Frequently Asked Questions');
  return (
    <><PageHero title="Frequently Asked Questions" image={IMAGES.learning} />
      <Section><div className="mx-auto max-w-3xl divide-y divide-line rounded-lg border border-line">{DEFAULT_FAQ.map((f) => (
        <details key={f.q} className="group p-5"><summary className="cursor-pointer list-none font-heading font-medium text-forest-700 marker:hidden">{f.q}</summary><p className="mt-2 text-sm text-muted">{f.a}</p></details>))}</div></Section></>
  );
}

export function ResourcesPage() {
  useSeo('Learning Resources', 'Free and open learning resources from Episteme Learning Academy.');
  const { data, loading } = useCollection<Course>(C.courses, () => [where('visibility', '==', 'public'), where('status', '==', 'published')], 'public');
  return (
    <><PageHero title="Learning Resources" lead="Open courses and materials from the Episteme Digital Learning Hub." image={IMAGES.digitalHub} />
      <Section>{loading ? <Spinner /> : data.length === 0 ? <EmptyState title="Resources are being prepared" description="Enrolled learners can access all courses by signing in to the portal." action={<Link to="/login"><Button>Portal login</Button></Link>} /> : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{data.map((c) => (
          <Card key={c.id} className="overflow-hidden">{c.thumbnail && <img src={c.thumbnail} alt="" className="aspect-[16/9] w-full object-cover" loading="lazy" />}
            <div className="p-5"><p className="text-xs uppercase tracking-wide text-gold-600">{c.category}</p><h2 className="mt-1 text-lg font-semibold">{c.title}</h2><p className="mt-2 text-sm text-muted line-clamp-3">{c.description}</p>
              <Link to="/login" className="mt-3 inline-block text-sm font-medium text-forest-500 underline underline-offset-4">Sign in to learn</Link></div></Card>))}</div>)}</Section></>
  );
}

export function SearchPage() {
  useSeo('Search');
  const [q, setQ] = useState('');
  const posts = useCollection<Post>(C.posts, () => [where('status', '==', 'published')], 'pub');
  const pages = useCollection<CmsPage>(C.pages, () => [where('status', '==', 'published')], 'pub');
  const progs = useCollection<Programme>(C.programmes, () => [where('status', '==', 'published')], 'pub');
  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const all = [
      ...DEFAULT_PAGES.filter((p) => !pages.data.some((c) => c.id === p.slug)).map((p) => ({ title: p.title, text: stripHtml(p.body), to: `/${p.slug}` })),
      ...pages.data.map((p) => ({ title: p.title, text: stripHtml(p.body), to: `/${p.id}` })),
      ...posts.data.map((p) => ({ title: p.title, text: `${p.excerpt} ${stripHtml(p.body)}`, to: `/blog/${p.slug || p.id}` })),
      ...(progs.data.length ? progs.data.map((p) => ({ title: p.title, text: p.summary, to: p.link || '/programmes' })) : DEFAULT_PROGRAMMES.map((p) => ({ title: p.title, text: p.summary, to: p.link }))),
    ];
    return all.filter((r) => `${r.title} ${r.text}`.toLowerCase().includes(t)).slice(0, 30);
  }, [q, posts.data, pages.data, progs.data]);
  return (
    <><PageHero title="Search" /><Section><div className="mx-auto max-w-2xl">
      <div className="relative"><SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input autoFocus aria-label="Search the website" className="pl-9" placeholder="Search programmes, pages and articles…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <ul className="mt-6 divide-y divide-line">{results.map((r) => <li key={r.to + r.title}><Link to={r.to} className="block py-4 hover:bg-cream"><p className="font-medium text-forest-700">{r.title}</p><p className="text-sm text-muted line-clamp-2">{r.text}</p></Link></li>)}</ul>
      {q.trim().length >= 2 && results.length === 0 && <EmptyState title="No results" description="Try a different word." />}</div></Section></>
  );
}

export function VerifyCertificatePage() {
  useSeo('Verify certificate');
  const { code = '' } = useParams();
  const [state, setState] = useState<{ loading: boolean; cert: { studentName: string; courseTitle: string; issuedAt: unknown } | null }>({ loading: true, cert: null });
  useEffect(() => { void getById<{ studentName: string; courseTitle: string; issuedAt: unknown }>(C.certificates, code).then((c) => setState({ loading: false, cert: c })).catch(() => setState({ loading: false, cert: null })); }, [code]);
  return (
    <><PageHero title="Certificate verification" /><Section><div className="mx-auto max-w-lg text-center">{state.loading ? <Spinner /> : state.cert ? (
      <div role="status"><CheckCircle2 className="mx-auto h-12 w-12 text-ok" /><h2 className="mt-3 text-xl font-semibold">Valid certificate</h2>
        <p className="mt-3"><strong>{state.cert.studentName}</strong> completed <strong>{state.cert.courseTitle}</strong>.</p><p className="text-sm text-muted">Issued {fmtDate(state.cert.issuedAt)} · Code {code}</p></div>
    ) : <EmptyState title="Certificate not found" description={`No certificate matches code “${code}”.`} />}</div></Section></>
  );
}

export function NotFound() {
  useSeo('Page not found');
  return <Section><EmptyState title="Page not found" description="The page you are looking for does not exist." action={<Link to="/"><Button>Go home</Button></Link>} /></Section>;
}
