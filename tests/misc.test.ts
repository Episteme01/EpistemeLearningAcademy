import { describe, expect, it } from 'vitest';
import { seededPick, seededShuffle } from '@/lib/cbt/shuffle';
import { CSV_TEMPLATE, parseQuestionCsv } from '@/lib/cbt/csvQuestions';
import { DEFAULT_GRADING_SCALE, computeSubjectResult, rankPositions, ordinal, validateScores } from '@/lib/assessment';
import { applyPayment, invoiceStatus, invoiceTotal } from '@/lib/finance';
import { parseCsv, toCsv } from '@/lib/csv';
import { sanitizeHtml } from '@/lib/sanitize';
import { can } from '@/config/permissions';

describe('shuffle', () => {
  it('is deterministic and a permutation', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(seededShuffle(a, 'x')).toEqual(seededShuffle(a, 'x'));
    expect([...seededShuffle(a, 'x')].sort()).toEqual(a);
  });
  it('picks N or all', () => {
    expect(seededPick([1, 2, 3, 4], 2, 's')).toHaveLength(2);
    expect(seededPick([1, 2, 3, 4], 0, 's')).toHaveLength(4);
  });
});

describe('question CSV import', () => {
  it('parses the shipped template without errors', () => {
    const r = parseQuestionCsv(CSV_TEMPLATE);
    expect(r.errors).toEqual([]); expect(r.valid).toHaveLength(3);
    expect(r.valid[0]!.key.correct).toBeTruthy();
  });
  it('reports bad rows with line numbers and keeps good ones', () => {
    const csv = CSV_TEMPLATE + '\r\nmcq,"No options",,,,,,A,1,easy,,,';
    const r = parseQuestionCsv(csv);
    expect(r.valid).toHaveLength(3); expect(r.errors.length).toBe(1);
  });
});

describe('assessment', () => {
  it('computes grade and validates score caps', () => {
    expect(computeSubjectResult(35, 55, DEFAULT_GRADING_SCALE).total).toBe(90);
    expect(validateScores(50, 10, { caMax: 40, examMax: 60 })).not.toBeNull();
    expect(validateScores(30, 50, { caMax: 40, examMax: 60 })).toBeNull();
  });
  it('ranks with ties sharing a position', () => {
    const r = rankPositions([{ id: 'a', total: 90 }, { id: 'b', total: 90 }, { id: 'c', total: 70 }]);
    expect(r).toEqual({ a: 1, b: 1, c: 3 }); expect(ordinal(3)).toBe('3rd'); expect(ordinal(11)).toBe('11th');
  });
});

describe('finance', () => {
  it('totals and statuses', () => {
    expect(invoiceTotal([{ amount: 100.1 }, { amount: 50.2 }])).toBe(150.3);
    expect(invoiceStatus(100, 0)).toBe('unpaid'); expect(invoiceStatus(100, 40)).toBe('partial'); expect(invoiceStatus(100, 100)).toBe('paid');
    expect(invoiceStatus(100, 0, '2000-01-01')).toBe('overdue');
  });
  it('rejects overpayment and zero payment', () => {
    expect(() => applyPayment({ total: 100, paid: 90 }, 20)).toThrow();
    expect(() => applyPayment({ total: 100, paid: 0 }, 0)).toThrow();
    expect(applyPayment({ total: 100, paid: 50 }, 50).status).toBe('paid');
  });
});

describe('csv + sanitiser + permissions', () => {
  it('round-trips quoted CSV', () => {
    const rows = [['a', 'b,c', 'd"e'], ['1', '2', '3']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it('strips scripts and event handlers', () => {
    const out = sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a>');
    expect(out).not.toMatch(/script|onclick|javascript:/i);
    // Without a DOM (plain Node) the sanitiser fails closed and returns ''. In jsdom/browser it keeps safe content.
    if (typeof DOMParser !== 'undefined') expect(out).toContain('Hi');
  });
  it('permissions are role-restricted', () => {
    expect(can('student', 'finance.manage' as never)).toBe(false);
  });
});
