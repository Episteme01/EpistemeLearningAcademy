import katex from 'katex';
import 'katex/dist/katex.min.css';

/** Loaded on demand (dynamic import) so pages without formulas never download KaTeX. */
export function texToHtml(tex: string, display: boolean): string {
  return katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: 'ignore', output: 'htmlAndMathml', maxExpand: 1000, maxSize: 20 });
}
