import { useState } from 'react';
import { InstallBanner } from '@/components/common/InstallApp';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Mail, MapPin, Menu, Phone, Search, X } from 'lucide-react';
import { BRAND, IMAGES, whatsappLink } from '@/config/brand';
import { Button } from '@/components/ui/button';
import { useSettings } from '@/hooks/useSettings';
import { DEFAULT_NAV } from './content';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

export interface SiteSettings {
  name: string; tagline: string; logo: string; email: string; phones: string[]; address: string;
  facebook: string; instagram: string; youtube: string; tiktok: string; whatsapp: string; footerText: string;
}
export const SITE_DEFAULTS: SiteSettings = {
  name: BRAND.name, tagline: BRAND.motto, logo: BRAND.logo, email: BRAND.email, phones: [...BRAND.phones], address: BRAND.location,
  facebook: '', instagram: '', youtube: '', tiktok: '', whatsapp: BRAND.whatsapp, footerText: '',
};
interface NavSettings { items: string[] }

export function useSite() { return useSettings<SiteSettings>('site', SITE_DEFAULTS); }

export function PublicLayout() {
  const site = useSite();
  const navCfg = useSettings<NavSettings>('navigation', { items: [] });
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [pathname]);

  const items = navCfg.items?.length
    ? navCfg.items.map((l) => { const [label, to] = l.split('|').map((s) => s.trim()); return { label: label ?? '', to: to || '/' }; })
    : DEFAULT_NAV;
  const social = [
    { href: site.facebook, icon: IMAGES.icons.facebook, label: 'Facebook' },
    { href: site.instagram, icon: IMAGES.icons.instagram, label: 'Instagram' },
    { href: site.youtube, icon: IMAGES.icons.youtube, label: 'YouTube' },
    { href: site.tiktok, icon: IMAGES.icons.tiktok, label: 'TikTok' },
  ].filter((s) => s.href);

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <div className="hidden bg-forest-800 text-[12.5px] text-forest-100 md:block">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-1.5">
          <span className="flex items-center gap-4"><span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden />{site.address}</span>
            <a href={`mailto:${site.email}`} className="flex items-center gap-1.5 hover:text-white"><Mail className="h-3.5 w-3.5" aria-hidden />{site.email}</a></span>
          <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" aria-hidden />{site.phones.join(' · ')}</span>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-7xl items-center gap-6 px-4 md:px-6">
          <Link to="/" className="flex items-center gap-3">
            <img src={site.logo || BRAND.logo} alt="" className="h-11 w-11 object-contain" />
            <span className="leading-tight"><span className="block font-heading text-[15px] font-semibold text-forest-700">{site.name}</span>
              <span className="hidden text-[11px] text-muted sm:block">{site.tagline}</span></span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden items-center gap-1 lg:flex">
            {items.map((i) => (
              <NavLink key={i.to + i.label} to={i.to} end={i.to === '/'} className={({ isActive }) => cn('rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors', isActive ? 'text-forest-700 shadow-[inset_0_-2px_0_var(--color-gold-400)]' : 'text-ink hover:text-forest-500')}>{i.label}</NavLink>
            ))}
            <Link to="/search" aria-label="Search the site" className="rounded-md p-2 text-forest-700 hover:bg-forest-50"><Search className="h-4 w-4" /></Link>
            <Link to="/login"><Button variant="outline" size="sm">Portal login</Button></Link>
            <Link to="/admissions"><Button variant="gold" size="sm">Apply now</Button></Link>
          </nav>
          <button className="ml-auto rounded-md p-2 text-forest-700 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? <X /> : <Menu />}</button>
        </div>
        {open && (
          <nav aria-label="Mobile" className="border-t border-line bg-white px-4 pb-4 lg:hidden">
            {[...items, { label: 'Search', to: '/search' }].map((i) => <NavLink key={i.to + i.label} to={i.to} end={i.to === '/'} className="block border-b border-line/60 py-3 text-[15px] font-medium">{i.label}</NavLink>)}
            <div className="mt-4 flex gap-2"><Link to="/login" className="flex-1"><Button variant="outline" className="w-full">Portal login</Button></Link><Link to="/admissions" className="flex-1"><Button variant="gold" className="w-full">Apply now</Button></Link></div>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1"><Outlet /></main>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4"><InstallBanner /></div>

      <a href={whatsappLink('Hello Episteme Learning Academy, I would like to enquire.')} target="_blank" rel="noopener noreferrer" aria-label="Chat on WhatsApp"
        className="fixed bottom-4 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-pop ring-1 ring-line hover:scale-105 transition-transform">
        <img src={IMAGES.icons.whatsapp} alt="" className="h-8 w-8" />
      </a>

      <footer className="bg-forest-800 text-forest-100">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="flex items-center gap-3"><img src={site.logo || BRAND.logo} alt="" className="h-12 w-12 rounded bg-white p-0.5 object-contain" /><p className="font-heading text-lg font-semibold text-white">{site.name}</p></div>
            <p className="mt-3 max-w-md text-sm text-forest-200">{site.footerText || `${BRAND.motto}. ${BRAND.philosophy.join(' + ')}.`}</p>
            <div className="mt-4 flex gap-3">{social.map((s) => <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.label}><img src={s.icon} alt="" className="h-7 w-7 rounded" /></a>)}</div>
          </div>
          <div><p className="font-heading text-sm font-semibold text-gold-300">Explore</p>
            <ul className="mt-3 space-y-2 text-sm">{[['About', '/about'], ['Programmes', '/programmes'], ['Admissions', '/admissions'], ['FAQ', '/faq'], ['Blog & news', '/blog'], ['Islamic portal', '/islamic'], ['From the ELA Community', '/spotlight']].map(([l, t]) => <li key={t}><Link className="hover:text-white" to={t as string}>{l}</Link></li>)}</ul></div>
          <div><p className="font-heading text-sm font-semibold text-gold-300">Contact</p>
            <ul className="mt-3 space-y-2 text-sm"><li>{site.address}</li><li><a className="hover:text-white" href={`mailto:${site.email}`}>{site.email}</a></li>
              {site.phones.map((p) => <li key={p}><a className="hover:text-white" href={`tel:${p}`}>{p}</a></li>)}
              <li><a className="hover:text-white" href={whatsappLink()} target="_blank" rel="noopener noreferrer">WhatsApp</a></li></ul></div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-forest-300">
          © {new Date().getFullYear()} {site.name}. <Link to="/privacy-policy" className="underline">Privacy</Link> · <Link to="/terms" className="underline">Terms</Link>
        </div>
      </footer>
    </div>
  );
}
