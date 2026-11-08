import { z } from 'zod';
import { parseCsv } from '@/lib/csv';

/**
 * Validated CSV import for the question bank.
 *
 * Columns (header row required, order free):
 *   type, prompt, optionA, optionB, optionC, optionD, optionE, correct, marks,
 *   difficulty, topic, explanation, manual
 *
 *  - type: mcq | tf | short
 *  - mcq correct: A-E (letter of the correct option)
 *  - tf correct:  true | false
 *  - short correct: one or more accepted answers separated by "|"
 *  - manual: "yes" to require a human marker (short answers only)
 */
export const CSV_TEMPLATE_HEADERS = [
  'type', 'prompt', 'optionA', 'optionB', 'optionC', 'optionD', 'optionE',
  'correct', 'marks', 'difficulty', 'topic', 'explanation', 'manual',
] as const;

export const CSV_TEMPLATE = [
  CSV_TEMPLATE_HEADERS.join(','),
  'mcq,"What is 1/2 + 1/2?",1,2,1/4,0,,A,1,easy,Fractions,"Two halves make one whole",',
  'tf,"The Sun is a star.",,,,,,true,1,easy,Solar System,,',
  'short,"Name the capital of Nigeria.",,,,,,Abuja,1,easy,General Knowledge,,',
].join('\r\n');

const rowSchema = z
  .object({
    type: z.enum(['mcq', 'tf', 'short']),
    prompt: z.string().trim().min(3, 'prompt is too short').max(2000),
    options: z.array(z.string().trim().min(1)).max(5),
    correct: z.string().trim().min(1, 'correct answer is required'),
    marks: z.number().positive().max(100),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    topic: z.string().trim().max(120),
    explanation: z.string().trim().max(1000),
    manual: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'mcq') {
      if (v.options.length < 2) ctx.addIssue({ code: 'custom', message: 'mcq needs at least 2 options' });
      const idx = 'ABCDE'.indexOf(v.correct.toUpperCase());
      if (v.correct.length !== 1 || idx < 0 || idx >= v.options.length)
        ctx.addIssue({ code: 'custom', message: 'correct must be a letter A-E matching a filled option' });
    }
    if (v.type === 'tf' && !['true', 'false'].includes(v.correct.toLowerCase()))
      ctx.addIssue({ code: 'custom', message: 'correct must be true or false' });
  });

export interface ParsedQuestion {
  type: 'mcq' | 'tf' | 'short';
  prompt: string;
  options: { id: string; text: string }[];
  /** answer-key payload (kept separately from the question) */
  key: { correct?: string; accepted?: string[]; manual?: boolean; explanation?: string };
  marks: number;
  difficulty: 'easy' | 'medium' | 'hard';
  topic: string;
}

export interface CsvImportResult {
  valid: ParsedQuestion[];
  errors: { line: number; message: string }[];
}

export function parseQuestionCsv(text: string): CsvImportResult {
  const rows = parseCsv(text);
  const result: CsvImportResult = { valid: [], errors: [] };
  if (rows.length < 2) {
    result.errors.push({ line: 1, message: 'File must contain a header row and at least one question.' });
    return result;
  }
  const header = (rows[0] as string[]).map((h) => h.trim().toLowerCase());
  for (const required of ['type', 'prompt', 'correct']) {
    if (!header.includes(required)) {
      result.errors.push({ line: 1, message: `Missing required column "${required}".` });
    }
  }
  if (result.errors.length) return result;
  const col = (r: string[], name: string) => (r[header.indexOf(name.toLowerCase())] ?? '').trim();

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const type = col(r, 'type').toLowerCase();
    const opts = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE'].map((n) => col(r, n));
    const options = type === 'mcq' ? opts.filter((o) => o !== '') : [];
    const candidate = {
      type,
      prompt: col(r, 'prompt'),
      options,
      correct: col(r, 'correct'),
      marks: col(r, 'marks') === '' ? 1 : Number(col(r, 'marks')),
      difficulty: (col(r, 'difficulty') || 'medium').toLowerCase(),
      topic: col(r, 'topic'),
      explanation: col(r, 'explanation'),
      manual: ['yes', 'true', '1', 'y'].includes(col(r, 'manual').toLowerCase()),
    };
    // MCQ options must be contiguous from A so that the letter maps to the right option.
    if (type === 'mcq' && opts.findIndex((o) => o === '') !== -1 && opts.findIndex((o) => o === '') < options.length) {
      result.errors.push({ line, message: 'options must be filled in order (A, B, C...) without gaps' });
      return;
    }
    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) {
      result.errors.push({ line, message: parsed.error.issues.map((x) => x.message).join('; ') });
      return;
    }
    const v = parsed.data;
    const optionObjs = v.options.map((text, k) => ({ id: `o${k + 1}`, text }));
    let key: ParsedQuestion['key'];
    if (v.type === 'mcq') key = { correct: `o${'ABCDE'.indexOf(v.correct.toUpperCase()) + 1}` };
    else if (v.type === 'tf') key = { correct: v.correct.toLowerCase() };
    else key = { accepted: v.correct.split('|').map((s) => s.trim()).filter(Boolean), manual: v.manual };
    if (v.explanation) key.explanation = v.explanation;
    result.valid.push({
      type: v.type,
      prompt: v.prompt,
      options: optionObjs,
      key,
      marks: v.marks,
      difficulty: v.difficulty,
      topic: v.topic,
    });
  });
  return result;
}
