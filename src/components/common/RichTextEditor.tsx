import { useEffect, useRef } from 'react';
import { Bold, Italic, Underline, Subscript, Superscript, Table as TableIcon, Heading2, Heading3, List, ListOrdered, Link as LinkIcon, Quote, Eraser, ImageIcon } from 'lucide-react';
import { sanitizeHtml } from '@/lib/sanitize';
import { cn } from '@/lib/utils';

/**
 * Lightweight dependency-free rich text editor (contentEditable + execCommand).
 * Output is passed through the allow-list sanitiser on every change.
 */
export function RichTextEditor({ value, onChange, id, invalid }: { value: string; onChange: (html: string) => void; id?: string; invalid?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>('');

  useEffect(() => {
    const el = ref.current;
    if (el && value !== last.current) {
      el.innerHTML = sanitizeHtml(value || '');
      last.current = value;
    }
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const html = sanitizeHtml(el.innerHTML);
    last.current = html;
    onChange(html);
  };
  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };
  const link = () => {
    const url = window.prompt('Link URL (https://…)');
    if (url) cmd('createLink', url);
  };
  const image = () => {
    const url = window.prompt('Image URL (https://… or /images/…)');
    if (url) cmd('insertImage', url);
  };

  const table = () => {
    const rows = Math.min(20, Math.max(1, parseInt(window.prompt('Number of rows', '3') ?? '', 10) || 0));
    const cols = Math.min(8, Math.max(1, parseInt(window.prompt('Number of columns', '3') ?? '', 10) || 0));
    if (!rows || !cols) return;
    const cell = (t: string) => `<${t}>&nbsp;</${t}>`;
    const html = `<table><thead><tr>${Array.from({ length: cols }, () => cell('th')).join('')}</tr></thead><tbody>${Array.from({ length: rows - 1 || 1 }, () => `<tr>${Array.from({ length: cols }, () => cell('td')).join('')}</tr>`).join('')}</tbody></table><p></p>`;
    cmd('insertHTML', html);
  };
  const symbol = (s: string) => { if (s) cmd('insertText', s); };

  const tools: { icon: typeof Bold; label: string; run: () => void }[] = [
    { icon: Bold, label: 'Bold', run: () => cmd('bold') },
    { icon: Italic, label: 'Italic', run: () => cmd('italic') },
    { icon: Underline, label: 'Underline', run: () => cmd('underline') },
    { icon: Superscript, label: 'Superscript (powers, e.g. x²)', run: () => cmd('superscript') },
    { icon: Subscript, label: 'Subscript (e.g. H₂O)', run: () => cmd('subscript') },
    { icon: Heading2, label: 'Heading', run: () => cmd('formatBlock', 'h2') },
    { icon: Heading3, label: 'Sub-heading', run: () => cmd('formatBlock', 'h3') },
    { icon: List, label: 'Bulleted list', run: () => cmd('insertUnorderedList') },
    { icon: ListOrdered, label: 'Numbered list', run: () => cmd('insertOrderedList') },
    { icon: Quote, label: 'Quote', run: () => cmd('formatBlock', 'blockquote') },
    { icon: LinkIcon, label: 'Insert link', run: link },
    { icon: ImageIcon, label: 'Insert image', run: image },
    { icon: TableIcon, label: 'Insert table', run: table },
    { icon: Eraser, label: 'Clear formatting', run: () => cmd('removeFormat') },
  ];

  return (
    <div className={cn('rounded-md border bg-white', invalid ? 'border-danger' : 'border-line')}>
      <div className="flex flex-wrap gap-0.5 border-b border-line bg-cream p-1" role="toolbar" aria-label="Formatting">
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.run}
            className="rounded p-2 text-ink hover:bg-forest-100">
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        <select aria-label="Insert a maths symbol" defaultValue="" onChange={(e) => { symbol(e.target.value); e.target.value = ''; }} className="rounded border border-line bg-white px-1 text-sm">
          <option value="">Σ symbols</option>
          {['π', '√', '²', '³', '½', '¼', '¾', '±', '×', '÷', '≤', '≥', '≠', '≈', '∞', '∑', '∫', 'α', 'β', 'θ', 'λ', 'Δ', 'Ω', '°', '→', '∴'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div
        id={id}
        ref={ref}
        role="textbox"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        className="prose-ela min-h-56 max-w-none px-4 py-3 focus:outline-none"
      />
    </div>
  );
}
