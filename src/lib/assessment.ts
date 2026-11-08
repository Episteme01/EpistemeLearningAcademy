/** Pure EMS assessment logic: configurable grading scales, totals, averages, positions. */
export interface GradeBand {
  min: number;
  max: number;
  grade: string;
  remark: string;
}

export interface GradingScale {
  id?: string;
  name: string;
  isDefault?: boolean;
  bands: GradeBand[];
}

export interface AssessmentConfig {
  /** maximum continuous-assessment score */
  caMax: number;
  /** maximum examination score */
  examMax: number;
}

export const DEFAULT_ASSESSMENT: AssessmentConfig = { caMax: 40, examMax: 60 };

/** Starting scale. Schools can edit/replace it under EMS → Grading scales. */
export const DEFAULT_GRADING_SCALE: GradingScale = {
  name: 'Standard (A–F)',
  isDefault: true,
  bands: [
    { min: 75, max: 100, grade: 'A', remark: 'Excellent' },
    { min: 65, max: 74.99, grade: 'B', remark: 'Very good' },
    { min: 50, max: 64.99, grade: 'C', remark: 'Good' },
    { min: 45, max: 49.99, grade: 'D', remark: 'Fair' },
    { min: 40, max: 44.99, grade: 'E', remark: 'Pass' },
    { min: 0, max: 39.99, grade: 'F', remark: 'Fail' },
  ],
};

export function gradeFor(total: number, scale: GradingScale): { grade: string; remark: string } {
  const t = Math.max(0, Math.min(100, total));
  const band = scale.bands.find((b) => t >= b.min && t <= b.max);
  return band ? { grade: band.grade, remark: band.remark } : { grade: '-', remark: '' };
}

/** Validate that bands cover 0–100 without gaps or overlaps (for the scale editor). */
export function validateScale(bands: GradeBand[]): string[] {
  const errors: string[] = [];
  if (bands.length === 0) return ['Add at least one band.'];
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  if (sorted[0] && sorted[0].min !== 0) errors.push('Lowest band must start at 0.');
  if (sorted[sorted.length - 1] && (sorted[sorted.length - 1] as GradeBand).max < 100) errors.push('Highest band must reach 100.');
  for (let i = 0; i < sorted.length; i++) {
    const b = sorted[i] as GradeBand;
    if (b.min > b.max) errors.push(`Band ${b.grade}: min is greater than max.`);
    const next = sorted[i + 1];
    if (next) {
      if (next.min <= b.max) errors.push(`Bands ${b.grade} and ${next.grade} overlap.`);
      else if (next.min - b.max > 1.01) errors.push(`Gap between ${b.grade} and ${next.grade}.`);
    }
  }
  return errors;
}

export function validateScores(ca: number, exam: number, cfg: AssessmentConfig): string | null {
  if (Number.isNaN(ca) || Number.isNaN(exam)) return 'Scores must be numbers.';
  if (ca < 0 || exam < 0) return 'Scores cannot be negative.';
  if (ca > cfg.caMax) return `Continuous assessment cannot exceed ${cfg.caMax}.`;
  if (exam > cfg.examMax) return `Exam cannot exceed ${cfg.examMax}.`;
  return null;
}

export function computeSubjectResult(ca: number, exam: number, scale: GradingScale) {
  const total = Math.round((ca + exam) * 100) / 100;
  return { total, ...gradeFor(total, scale) };
}

export interface TermSummary {
  total: number;
  average: number;
  subjects: number;
}

export function summarise(totals: number[]): TermSummary {
  const total = totals.reduce((s, n) => s + n, 0);
  return { total, subjects: totals.length, average: totals.length ? Math.round((total / totals.length) * 100) / 100 : 0 };
}

/** Standard competition ranking ("1224"): ties share a position. */
export function rankPositions(entries: { id: string; total: number }[]): Record<string, number> {
  const sorted = [...entries].sort((a, b) => b.total - a.total);
  const out: Record<string, number> = {};
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    out[e.id] = prev && prev.total === e.total ? (out[prev.id] as number) : i + 1;
  });
  return out;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0] as string);
}
