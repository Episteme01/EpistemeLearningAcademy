import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves a project site from /<repository-name>/.
// The deploy workflow computes VITE_BASE_PATH from the repository name automatically
// ("/" for a <user>.github.io repo, "/<repo>/" otherwise). Set it yourself for a custom domain ("/").
/** Emits manifest.webmanifest, version.json and sw.js (no extra dependency). */
function pwa(base: string, buildId: string): Plugin {
  const sw = `// ELA service worker. Network-first, so a new deploy is picked up on the next visit.
const BASE = ${JSON.stringify(base)};
const SHELL = 'ela-shell-${buildId}';
const ASSETS = 'ela-assets';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(SHELL).then((c) => c.add(new Request(BASE, { cache: 'reload' }))).catch(() => {})); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== SHELL && k !== ASSETS) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'Episteme Learning Academy', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Episteme Learning Academy', { body: d.body || '', icon: BASE + 'icons/icon-192.png', badge: BASE + 'icons/icon-192.png', data: { url: d.url || BASE } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                    // Firebase and other APIs: never touched
  if (url.pathname.endsWith('/version.json') || url.pathname.endsWith('/sw.js')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((r) => {
      if (r.ok && url.pathname === BASE) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(BASE, copy)); }
      return r;
    }).catch(() => caches.match(BASE).then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith(BASE + 'assets/')) {                      // hashed files never change: cache-first
    e.respondWith(caches.open(ASSETS).then(async (c) => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  e.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => caches.match(req).then((r) => r || Response.error())));
});
`;
  const manifest = {
    id: base, name: 'Episteme Learning Academy', short_name: 'ELA', description: 'Where Learning Meets Morality',
    start_url: base + 'app', scope: base, display: 'standalone', orientation: 'portrait-primary',
    theme_color: '#0B3D2E', background_color: '#FAF9F5',
    icons: [
      { src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: base + 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return {
    name: 'ela-pwa',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest) });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: buildId }) });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = env.VITE_BASE_PATH || '/';
  const buildId = mode === 'production' ? Date.now().toString(36) : 'dev';
  return {
    base,
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    plugins: [react(), tailwindcss(), pwa(base, buildId)],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
            charts: ['recharts'],
            react: ['react', 'react-dom', 'react-router-dom'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
