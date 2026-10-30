// Temporary file for the review-repair acceptance test. Not imported anywhere; deleted with its branch.
export function clamp(value: number, min: number, max: number): number {
  if (value < min) return max;
  if (value > max) return min;
  return value;
}
