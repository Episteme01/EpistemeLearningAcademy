// Mirror of src/lib/cbt/grade.ts. Keep both in sync (tests cover the TypeScript copy).
const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const blank = (a) => a === undefined || a === null || String(a).trim() === '';
function gradeQuestion(q, key, answer, cfg, manual) {
  const max = q.marks;
  if (q.type === 'short' && key?.manual) {
    if (manual !== undefined) return { questionId: q.id, status: manual > 0 ? 'correct' : 'wrong', awarded: Math.min(max, Math.max(0, manual)), max };
    return { questionId: q.id, status: blank(answer) ? 'unanswered' : 'pending', awarded: 0, max };
  }
  if (blank(answer)) return { questionId: q.id, status: 'unanswered', awarded: 0, max };
  let ok = false;
  if (q.type === 'short') ok = (key?.accepted ?? []).some((a) => norm(a) === norm(answer));
  else ok = norm(key?.correct) === norm(answer);
  if (ok) return { questionId: q.id, status: 'correct', awarded: max, max };
  const penalty = cfg.negativeMarking?.enabled ? max * cfg.negativeMarking.penalty : 0;
  return { questionId: q.id, status: 'wrong', awarded: -penalty, max };
}
function gradeAttempt({ questions, keys, answers, config, manualMarks = {} }) {
  const outcomes = questions.map((q) => gradeQuestion(q, keys[q.id], answers[q.id], config, manualMarks[q.id]));
  const total = questions.reduce((s, q) => s + q.marks, 0);
  const score = Math.round(Math.max(0, outcomes.reduce((s, o) => s + o.awarded, 0)) * 100) / 100;
  const percentage = total > 0 ? Math.round((score / total) * 10000) / 100 : 0;
  return { score, total, percentage, passed: percentage >= config.passMark, pendingManual: outcomes.filter((o) => o.status === 'pending').length, outcomes };
}
module.exports = { gradeAttempt };
