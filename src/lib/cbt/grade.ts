/**
 * Pure CBT / quiz grading logic. No Firebase or React imports so that it can be
 * unit-tested and mirrored by the optional Cloud Function (functions/grade.js).
 *
 * Answers are stored as:
 *   mcq   -> option id (string)
 *   tf    -> 'true' | 'false'
 *   short -> free text
 */
export type QuestionType = 'mcq' | 'tf' | 'short';

export interface PaperQuestion {
  id: string;
  type: QuestionType;
  marks: number;
}

export interface AnswerKey {
  /** mcq: option id, tf: 'true' | 'false' */
  correct?: string;
  /** short answers: accepted answers (case-insensitive) */
  accepted?: string[];
  /** true => requires a human marker (essay-style short answers) */
  manual?: boolean;
}

export interface GradeConfig {
  negativeMarking: { enabled: boolean; /** fraction of the question's marks, e.g. 0.25 */ penalty: number };
  /** pass mark as a percentage of total marks */
  passMark: number;
  floorAtZero?: boolean;
}

export type OutcomeStatus = 'correct' | 'wrong' | 'unanswered' | 'pending';

export interface QuestionOutcome {
  questionId: string;
  status: OutcomeStatus;
  awarded: number;
  max: number;
}

export interface GradeResult {
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  pendingManual: number;
  outcomes: QuestionOutcome[];
}

export function normaliseText(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;:!?'"`]+|[\s.,;:!?'"`]+$/g, '')
    .trim();
}

export function isBlank(answer: unknown): boolean {
  return answer === undefined || answer === null || (typeof answer === 'string' && answer.trim() === '');
}

export function gradeQuestion(
  q: PaperQuestion,
  key: AnswerKey | undefined,
  answer: unknown,
  cfg: GradeConfig,
  manualMark?: number,
): QuestionOutcome {
  const max = q.marks;
  if (!key) return { questionId: q.id, status: 'pending', awarded: 0, max };

  if (key.manual) {
    if (typeof manualMark === 'number') {
      const awarded = Math.min(Math.max(manualMark, 0), max);
      return { questionId: q.id, status: awarded > 0 ? 'correct' : 'wrong', awarded, max };
    }
    return { questionId: q.id, status: isBlank(answer) ? 'unanswered' : 'pending', awarded: 0, max };
  }

  if (isBlank(answer)) return { questionId: q.id, status: 'unanswered', awarded: 0, max };

  let correct = false;
  if (q.type === 'short') {
    const given = normaliseText(String(answer));
    correct = (key.accepted ?? []).some((a) => normaliseText(a) === given);
  } else {
    correct = String(answer) === String(key.correct);
  }

  if (correct) return { questionId: q.id, status: 'correct', awarded: max, max };
  const penalty = cfg.negativeMarking.enabled ? max * cfg.negativeMarking.penalty : 0;
  return { questionId: q.id, status: 'wrong', awarded: -penalty, max };
}

export function gradeAttempt(input: {
  questions: PaperQuestion[];
  keys: Record<string, AnswerKey | undefined>;
  answers: Record<string, unknown>;
  config: GradeConfig;
  manualMarks?: Record<string, number>;
}): GradeResult {
  const { questions, keys, answers, config, manualMarks = {} } = input;
  const outcomes = questions.map((q) => gradeQuestion(q, keys[q.id], answers[q.id], config, manualMarks[q.id]));
  const total = questions.reduce((s, q) => s + q.marks, 0);
  let score = outcomes.reduce((s, o) => s + o.awarded, 0);
  if (config.floorAtZero !== false) score = Math.max(0, score);
  score = Math.round(score * 100) / 100;
  const percentage = total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
  return {
    score,
    total,
    percentage,
    passed: percentage >= config.passMark,
    pendingManual: outcomes.filter((o) => o.status === 'pending').length,
    outcomes,
  };
}

/** Whether an attempt should be treated as submitted (explicit, or expired). */
export function isAttemptFinal(attempt: { status: string; deadlineMs: number }, nowMs: number, graceMs = 20_000): boolean {
  return attempt.status !== 'in_progress' || nowMs > attempt.deadlineMs + graceMs;
}
