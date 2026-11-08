import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, ExternalLink, LogOut, Menu, X } from 'lucide-react';
import { BRAND } from '@/config/brand';
import { NAV, navFor, platformsFor } from '@/config/nav';
import { PLATFORM_DESCRIPTIONS, PLATFORM_LABELS, ROLE_LABELS, ROLE_PLATFORMS, type Platform } from '@/config/permissions';
import { useAuth } from '@/features/auth/AuthContext';
import { Avatar } from '@/components/ui/data';
import { Notifications } from './Notifications';
import { cn } from '@/lib/utils';

function platformOf(pathname: string): Platform {
  const m = pathname.match(/^\/app\/(cms|ems|lms|cbt)/);
  return (m?.[1] as Platform) ?? 'home';
}

export function PortalLayout() {
  const { profile, role, roles, switchRole, logout } = useAuth();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const platform = platformOf(pathname);
  const platforms = useMemo(() => platformsFor(role, role ? ROLE_PLATFORMS[role] : []), [role]);
  const items = navFor(role, platform === 'home' ? 'home' : platform);
  const groups = useMemo(() => {
    const g = new Map<string, typeof items>();
    for (const i of items) g.set(i.group ?? '', [...(g.get(i.group ?? '') ?? []), i]);
    return [...g.entries()];
  }, [items]);

  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const firstPath = (p: Platform) => (p === 'home' ? '/app' : (NAV.find((n) => n.platform === p && n.roles.includes(role!))?.to ?? '/app'));

  const crumbs = useMemo(() => {
    const parts: { label: string; to?: string }[] = [{ label: 'Portal', to: '/app' }];
    if (platform !== 'home') parts.push({ label: PLATFORM_LABELS[platform], to: firstPath(platform) });
    const current = NAV.filter((n) => n.platform === platform && pathname.startsWith(n.to) && !n.end).sort((a, b) => b.to.length - a.to.length)[0];
    if (current) parts.push({ label: current.label });
    return parts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, platform, role]);

  const sidebar = (
    <nav aria-label="Primary" className="flex h-full flex-col">
      <div className="px-5 pb-4 pt-5">
        <p className="font-heading text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-300">{PLATFORM_LABELS[platform]}</p>
        <p className="text-[13px] text-forest-200">{PLATFORM_DESCRIPTIONS[platform]}</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {groups.map(([group, list]) => (
          <div key={group} className="mb-4">
            {group && <p className="px-3 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-forest-300">{group}</p>}
            <ul className="space-y-0.5">
              {list.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition-colors',
                      isActive ? 'bg-white/10 text-white shadow-[inset_2px_0_0_var(--color-gold-400)]' : 'text-forest-100 hover:bg-white/5 hover:text-white',
                    )}
                  >
                    <n.icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 p-4">
        <Link to="/" className="flex items-center gap-2 text-[13px] text-forest-200 hover:text-white">
          <ExternalLink className="h-4 w-4" aria-hidden /> View public website
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen bg-cream">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>

      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-64 bg-forest-700 lg:block">
        <Link to="/app" className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <img src={BRAND.logo} alt="" className="h-9 w-9 rounded bg-white object-contain p-0.5" />
          <span className="font-heading text-[15px] font-semibold leading-tight text-white">{BRAND.shortName} <span className="font-normal text-gold-300">Portal</span></span>
        </Link>
        <div className="h-[calc(100%-4rem)]">{sidebar}</div>
      </aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-forest-900/60" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-forest-700 shadow-pop">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
              <span className="font-heading font-semibold text-white">{BRAND.shortName} Portal</span>
              <button aria-label="Close menu" onClick={() => setDrawer(false)} className="rounded p-1 text-white"><X className="h-5 w-5" /></button>
            </div>
            <div className="h-[calc(100%-4rem)]">{sidebar}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
          <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
            <button className="rounded-md p-2 text-forest-700 hover:bg-forest-50 lg:hidden" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></button>

            {/* Platform switcher */}
            <nav aria-label="Platforms" className="hidden items-center gap-1 md:flex">
              {platforms.map((p) => (
                <Link key={p} to={firstPath(p)} aria-current={p === platform ? 'page' : undefined}
                  className={cn('rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
                    p === platform ? 'bg-forest-700 text-white' : 'text-forest-700 hover:bg-forest-50')}>
                  {PLATFORM_LABELS[p]}
                </Link>
              ))}
            </nav>
            <label className="md:hidden">
              <span className="sr-only">Switch platform</span>
              <select value={platform} onChange={(e) => { window.location.assign(`${import.meta.env.BASE_URL.replace(/\/$/, '')}${firstPath(e.target.value as Platform)}`); }}
                className="rounded-md border border-line bg-white px-2 py-1.5 text-sm text-forest-700">
                {platforms.map((p) => <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>)}
              </select>
            </label>

            <div className="ml-auto flex items-center gap-1">
              <Notifications />
              <div className="relative" ref={menuRef}>
                <button onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" className="flex items-center gap-2 rounded-md p-1.5 hover:bg-forest-50">
                  <Avatar name={profile?.displayName ?? '?'} src={profile?.photoUrl} />
                  <span className="hidden text-left leading-tight sm:block">
                    <span className="block text-[13px] font-medium">{profile?.displayName}</span>
                    <span className="block text-[11px] text-muted">{role ? ROLE_LABELS[role] : ''}</span>
                  </span>
                </button>
                {menu && (
                  <div role="menu" className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-line bg-white shadow-pop">
                    <div className="border-b border-line px-4 py-3">
                      <p className="truncate text-sm font-medium">{profile?.displayName}</p>
                      <p className="truncate text-xs text-muted">{profile?.email}</p>
                    </div>
                    {roles.length > 1 && (
                      <div className="border-b border-line px-2 py-2" role="group" aria-label="Switch workspace">
                        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Workspace</p>
                        {roles.map((r) => (
                          <button key={r} role="menuitemradio" aria-checked={r === role} onClick={() => { switchRole(r); setMenu(false); nav('/app'); }} className={cn('flex w-full items-center justify-between rounded px-2 py-2 text-left text-sm hover:bg-cream', r === role && 'font-semibold text-forest')}>
                            {ROLE_LABELS[r]}{r === role && <span aria-hidden>✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    <Link role="menuitem" to="/app/profile" onClick={() => setMenu(false)} className="block px-4 py-2.5 text-sm hover:bg-cream">My profile</Link>
                    <button role="menuitem" onClick={() => { void logout(); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-danger hover:bg-cream"><LogOut className="h-4 w-4" /> Sign out</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 overflow-x-auto px-4 pb-2 text-xs text-muted lg:px-8">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                {i > 0 && <ChevronRight className="h-3 w-3" aria-hidden />}
                {c.to && i < crumbs.length - 1 ? <Link className="hover:text-ink" to={c.to}>{c.label}</Link> : <span className="text-ink">{c.label}</span>}
              </span>
            ))}
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
