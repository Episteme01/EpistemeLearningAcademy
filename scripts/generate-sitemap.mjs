// Writes public/sitemap.xml for the static public routes. Runs automatically before `npm run build`.
import { writeFileSync } from 'node:fs';
const site = (process.env.VITE_SITE_URL || '').replace(/\/$/, '');
const base = (process.env.VITE_BASE_PATH || '/Episteme-Learning-Academy/').replace(/\/$/, '');
const routes = ['', 'about', 'vision-mission', 'philosophy', 'programmes', 'early-years-primary', 'secondary-education', 'islamic-education', 'ict-digital-skills', 'ela-ignite', 'web-development', 'admissions', 'resources', 'blog', 'contact', 'faq', 'privacy-policy', 'terms'];
if (!site) { console.log('VITE_SITE_URL not set: skipping sitemap.'); process.exit(0); }
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map((r) => `  <url><loc>${site}${base}/${r}</loc></url>`).join('\n')}\n</urlset>\n`;
writeFileSync('public/sitemap.xml', xml);
console.log(`sitemap.xml written (${routes.length} URLs)`);
