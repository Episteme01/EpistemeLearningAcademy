import { describe, expect, it } from 'vitest';
import { gradeAttempt, gradeQuestion, isAttemptFinal, normaliseText } from '@/lib/cbt/grade';

const cfg = { negativeMarking: { enabled: false, penalty: 0 }, passMark: 50 };
const qs = [{ id: 'a', type: 'mcq' as const, marks: 2 }, { id: 'b', type: 'tf' as const, marks: 1 }, { id: 'c', type: 'short' as const, marks: 2 }];
const keys = { a: { correct: 'o2' }, b: { correct: 'true' }, c: { accepted: ['Abuja'] } };

describe('CBT grading', () => {
  it('scores correct answers and ignores case/spacing on short answers', () => {
    const g = gradeAttempt({ questions: qs, keys, answers: { a: 'o2', b: 'true', c: '  abuja ' }, config: cfg });
    expect(g.score).toBe(5); expect(g.percentage).toBe(100); expect(g.passed).toBe(true);
  });
  it('gives zero for unanswered and wrong without negative marking', () => {
    const g = gradeAttempt({ questions: qs, keys, answers: { a: 'o1' }, config: cfg });
    expect(g.score).toBe(0); expect(g.passed).toBe(false);
  });
  it('applies negative marking to wrong answers only, never below zero', () => {
    const c = { negativeMarking: { enabled: true, penalty: 0.5 }, passMark: 50 };
    expect(gradeQuestion(qs[0]!, keys.a, 'o1', c).awarded).toBe(-1);
    expect(gradeQuestion(qs[0]!, keys.a, undefined, c).awarded).toBe(0);
    expect(gradeAttempt({ questions: qs, keys, answers: { a: 'o1' }, config: c }).score).toBe(0);
  });
  it('flags manual questions as pending until marked', () => {
    const k = { ...keys, c: { manual: true } };
    const g = gradeAttempt({ questions: qs, keys: k, answers: { a: 'o2', b: 'true', c: 'essay' }, config: cfg });
    expect(g.pendingManual).toBe(1);
    const m = gradeAttempt({ questions: qs, keys: k, answers: { a: 'o2', b: 'true', c: 'essay' }, config: cfg, manualMarks: { c: 1.5 } });
    expect(m.pendingManual).toBe(0); expect(m.score).toBe(4.5);
  });
  it('normalises text', () => { expect(normaliseText('  HeLLo   World ')).toBe('hello world'); });
  it('treats expired in-progress attempts as final after the grace period', () => {
    expect(isAttemptFinal({ status: 'in_progress', deadlineMs: 1000 }, 1000 + 21_000)).toBe(true);
    expect(isAttemptFinal({ status: 'in_progress', deadlineMs: 1000 }, 1000 + 5_000)).toBe(false);
    expect(isAttemptFinal({ status: 'submitted', deadlineMs: 1000 }, 0)).toBe(true);
  });
});
