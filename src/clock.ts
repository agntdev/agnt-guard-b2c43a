/** A single, replaceable clock seam for moderation deadlines and reports. */
let clock: () => number = () => Date.now();

export function now(): number {
  return clock();
}

/** Test hook. Application code should always call now(), never Date.now(). */
export function setClockForTests(next?: () => number): void {
  clock = next ?? (() => Date.now());
}
