import { useEffect } from 'react';
import { BRAND } from '@/config/brand';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

/** Client-side SEO: title, description and Open Graph tags (static hosting cannot server-render). */
export function useSeo(title?: string, description?: string, image?: string) {
  useEffect(() => {
    const full = title ? `${title} | ${BRAND.name}` : `${BRAND.name} — ${BRAND.motto}`;
    document.title = full;
    if (description) { setMeta('name', 'description', description); setMeta('property', 'og:description', description); }
    setMeta('property', 'og:title', full);
    if (image) setMeta('property', 'og:image', image.startsWith('http') ? image : `${BRAND.website}${image}`);
  }, [title, description, image]);
}
