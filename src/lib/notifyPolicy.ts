/** Browser copy of the reminder-offset rule used by the notify function (a test keeps both identical). */
export const DEFAULT_REMINDER_MINUTES = [60, 10];
export const cleanOffsets = (v: unknown): number[] => {
  const arr = Array.isArray(v) ? v : [];
  const out = [...new Set(arr.map(Number).filter((n) => Number.isFinite(n) && n >= 5 && n <= 1440).map(Math.round))].sort((a, b) => b - a);
  return out.length ? out.slice(0, 4) : DEFAULT_REMINDER_MINUTES;
};
