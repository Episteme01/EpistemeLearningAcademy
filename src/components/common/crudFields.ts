import { z } from 'zod';

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'tel' | 'url' | 'date' | 'datetime'
  | 'select' | 'ref' | 'checkbox' | 'image' | 'photo' | 'richtext' | 'list';

export interface Option { value: string; label: string }

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Option[];
  /** type 'ref': pick a document from another collection; stores its id and optionally a label */
  ref?: { collection: string; label: (row: Record<string, unknown> & { id: string }) => string; labelField?: string; filter?: (row: Record<string, unknown> & { id: string }) => boolean };
  defaultValue?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
  span?: 1 | 2;
  /** hide when editing an existing record (e.g. immutable codes) */
  createOnly?: boolean;
  /** type 'list': newline separated values stored as string[] */
}

export function buildSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    const req = !!f.required;
    switch (f.type) {
      case 'number': {
        let n = z.number({ invalid_type_error: `${f.label} must be a number`, required_error: `${f.label} is required` });
        if (f.min !== undefined) n = n.min(f.min, `${f.label} must be at least ${f.min}`);
        if (f.max !== undefined) n = n.max(f.max, `${f.label} must be at most ${f.max}`);
        s = req ? n : n.nullable().optional();
        break;
      }
      case 'checkbox':
        s = z.boolean().optional();
        break;
      case 'email':
        s = req ? z.string().trim().email('Enter a valid email address') : z.string().trim().email('Enter a valid email address').or(z.literal('')).optional();
        break;
      case 'url':
        s = z.string().trim().max(2000).refine((v) => v === '' || /^(https?:\/\/|\/)/i.test(v), 'Enter a full URL starting with https://').optional();
        if (req) s = (s as z.ZodOptional<z.ZodString>).refine((v) => !!v, `${f.label} is required`);
        break;
      case 'list':
        s = z.string().optional();
        break;
      default: {
        let t = z.string().trim().max(f.maxLength ?? (f.type === 'richtext' ? 200_000 : f.type === 'textarea' ? 10_000 : 500), `${f.label} is too long`);
        s = req ? t.min(1, `${f.label} is required`) : t.optional();
      }
    }
    shape[f.name] = s;
  }
  return z.object(shape).passthrough();
}

export function defaultsFor(fields: FieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined) out[f.name] = f.defaultValue;
    else if (f.type === 'checkbox') out[f.name] = false;
    else if (f.type === 'number') out[f.name] = undefined;
    else out[f.name] = '';
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
function toLocalInput(v: unknown): string {
  let d: Date | null = null;
  if (v && typeof v === 'object' && 'toDate' in v) d = (v as { toDate: () => Date }).toDate();
  else if (v instanceof Date) d = v;
  else if (typeof v === 'string' && v) d = new Date(v);
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Firestore document -> form values */
export function toFormValues(fields: FieldDef[], doc: Record<string, unknown> | null): Record<string, unknown> {
  const base = defaultsFor(fields);
  if (!doc) return base;
  for (const f of fields) {
    const v = doc[f.name];
    if (v === undefined || v === null) continue;
    if (f.type === 'datetime') base[f.name] = toLocalInput(v);
    else if (f.type === 'list') base[f.name] = Array.isArray(v) ? v.join('\n') : String(v);
    else base[f.name] = v;
  }
  return base;
}

/** Form values -> Firestore payload (Dates become Timestamps automatically in the SDK). */
export function fromFormValues(fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...values };
  for (const f of fields) {
    const v = values[f.name];
    if (f.type === 'datetime') out[f.name] = typeof v === 'string' && v ? new Date(v) : null;
    else if (f.type === 'list') out[f.name] = String(v ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
    else if (f.type === 'number') out[f.name] = typeof v === 'number' && !Number.isNaN(v) ? v : null;
  }
  return out;
}
