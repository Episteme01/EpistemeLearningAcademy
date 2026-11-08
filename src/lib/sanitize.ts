/**
 * Allow-list HTML sanitiser for CMS rich text (defence in depth: editors are
 * trusted staff, but content is rendered to the public with dangerouslySetInnerHTML).
 */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'a', 'blockquote', 'img', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'figure', 'figcaption', 'small', 'sup', 'sub',
]);
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
};

function safeUrl(url: string, allowData = false): boolean {
  const u = url.trim().toLowerCase();
  if (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('/') || u.startsWith('#')) return true;
  if (allowData && u.startsWith('data:image/') && !u.startsWith('data:image/svg')) return true;
  return !/^[a-z][a-z0-9+.-]*:/.test(u); // relative URL
}

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // drop dangerous containers entirely, unwrap harmless unknown tags
        if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button', 'svg', 'math', 'link', 'meta'].includes(tag)) {
          child.remove();
          continue;
        }
        walk(child);
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const allowed = ALLOWED_ATTRS[tag]?.includes(name);
        if (!allowed) {
          child.removeAttribute(attr.name);
          continue;
        }
        if ((name === 'href' || name === 'src') && !safeUrl(attr.value, tag === 'img')) child.removeAttribute(attr.name);
      }
      if (tag === 'a' && child.getAttribute('target') === '_blank') child.setAttribute('rel', 'noopener noreferrer');
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

export function stripHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/<[^>]+>/g, ' ');
  return (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '').replace(/\s+/g, ' ').trim();
}
