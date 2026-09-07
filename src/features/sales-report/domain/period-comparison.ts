export function calculatePeriodGrowth(
  current: number,
  previous: number,
): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;

  return ((current - previous) / Math.abs(previous)) * 100;
}
