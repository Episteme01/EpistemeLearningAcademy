import { useEffect, useState } from 'react';
import { escapeHtml, hasMath, renderMathInHtml } from '@/lib/math';

/** Returns the HTML straight away, then the same HTML with formulas typeset once KaTeX has loaded. */
export function useMathHtml(html: string): string {
  const [out, setOut] = useState(html);
  useEffect(() => {
    setOut(html);
    if (!hasMath(html)) return;
    let live = true;
    void import('@/lib/mathRender').then((m) => { if (live) setOut(renderMathInHtml(html, m.texToHtml)); }).catch(() => undefined);
    return () => { live = false; };
  }, [html]);
  return out;
}

/** Plain text (quiz and exam questions, options) with LaTeX typeset. Everything else is shown exactly as typed. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const html = useMathHtml(escapeHtml(text));
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
