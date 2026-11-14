/**
 * LaTeX detection for lessons, quizzes and exams. Pure and unit-tested; KaTeX itself is loaded on demand (see mathRender.ts).
 * Supported delimiters:  $...$  and  \(...\)  inline;  $$...$$  and  \[...\]  display;  \$  is a literal dollar sign.
 * A single $ only opens a formula when the next character is not a space and the closing $ is not followed by a digit,
 * so ordinary prices such as "$5 and $10" are left alone.
 */
export interface MathSeg { kind: 'text' | 'inline' | 'block'; value: string }

export function splitMath(input: string): MathSeg[] {
  const out: MathSeg[] = []; let buf = '';
  const flush = () => { if (buf) { out.push({ kind: 'text', value: buf }); buf = ''; } };
  const s = input; let i = 0;
  while (i < s.length) {
    const c = s[i]!; const two = s.slice(i, i + 2);
    if (two === '\\$') { buf += '$'; i += 2; continue; }
    if (two === '$$') {
      const j = s.indexOf('$$', i + 2);
      if (j > i + 2 && s.slice(i + 2, j).trim()) { flush(); out.push({ kind: 'block', value: s.slice(i + 2, j).trim() }); i = j + 2; continue; }
    }
    if (two === '\\[') {
      const j = s.indexOf('\\]', i + 2);
      if (j > i + 2 && s.slice(i + 2, j).trim()) { flush(); out.push({ kind: 'block', value: s.slice(i + 2, j).trim() }); i = j + 2; continue; }
    }
    if (two === '\\(') {
      const j = s.indexOf('\\)', i + 2);
      if (j > i + 2 && s.slice(i + 2, j).trim()) { flush(); out.push({ kind: 'inline', value: s.slice(i + 2, j).trim() }); i = j + 2; continue; }
    }
    if (c === '$' && i + 1 < s.length && !/[\s$]/.test(s[i + 1]!)) {
      let j = i + 1; let found = -1;
      while (j < s.length) {
        if (s[j] === '\n') break;
        if (s[j] === '\\') { j += 2; continue; }
        if (s[j] === '$') { found = j; break; }
        j += 1;
      }
      if (found > i + 1 && !/\s/.test(s[found - 1]!) && !/\d/.test(s[found + 1] ?? '')) { flush(); out.push({ kind: 'inline', value: s.slice(i + 1, found) }); i = found + 1; continue; }
    }
    buf += c; i += 1;
  }
  flush();
  return out;
}
export const hasMath = (s: string) => splitMath(s).some((x) => x.kind !== 'text');

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Replaces formulas found in the TEXT of already-sanitised HTML with `render(tex, display)` output (KaTeX).
 * Text inside <code> and <pre> is never touched. The formula source never becomes markup: only `render` output does.
 */
export function renderMathInHtml(html: string, render: (tex: string, display: boolean) => string): string {
  if (typeof DOMParser === 'undefined' || !hasMath(html)) return html;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const n of nodes) {
    if (n.parentElement?.closest('pre,code')) continue;
    const segs = splitMath(n.data);
    if (!segs.some((x) => x.kind !== 'text')) continue;
    const frag = doc.createDocumentFragment();
    for (const g of segs) {
      if (g.kind === 'text') { frag.append(doc.createTextNode(g.value)); continue; }
      const span = doc.createElement('span');
      span.className = g.kind === 'block' ? 'math-block' : 'math-inline';
      span.innerHTML = render(g.value, g.kind === 'block');
      frag.append(span);
    }
    n.replaceWith(frag);
  }
  return doc.body.innerHTML;
}
