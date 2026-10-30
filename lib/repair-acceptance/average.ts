// Temporary file for the review-repair acceptance test. Not imported anywhere; deleted with its branch.
export function average(values: number[]): number {
  let sum = 0;
  for (let i = 0; i <= values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}
