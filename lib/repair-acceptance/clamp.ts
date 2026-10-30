// Temporary file for the review-repair acceptance test. Not imported anywhere; deleted with its branch.
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
