/**
 * Tour helpers over a k×k distance matrix (row-major Float64Array).
 * A tour is a list of matrix indexes starting at 0 (the start point). When `closed`,
 * it returns to 0 at the end; otherwise it finishes wherever its last stop is.
 */

export type Matrix = { k: number; d: Float64Array };

export const at = (m: Matrix, i: number, j: number) => m.d[i * m.k + j];

export function tourLength(m: Matrix, tour: number[], closed: boolean): number {
  let len = 0;
  for (let i = 0; i + 1 < tour.length; i++) len += at(m, tour[i], tour[i + 1]);
  if (closed && tour.length > 1) len += at(m, tour[tour.length - 1], tour[0]);
  return len;
}

/** Cheapest place to put `c` in the tour: insert at index `pos` (before tour[pos]). */
export function bestInsertion(m: Matrix, tour: number[], c: number, closed: boolean): { pos: number; delta: number } {
  let best = { pos: tour.length, delta: Infinity };
  for (let i = 0; i < tour.length; i++) {
    const a = tour[i];
    const hasNext = i + 1 < tour.length || closed;
    const b = i + 1 < tour.length ? tour[i + 1] : tour[0];
    const delta = hasNext ? at(m, a, c) + at(m, c, b) - at(m, a, b) : at(m, a, c);
    if (delta < best.delta) best = { pos: i + 1, delta };
  }
  return best;
}

/** Greedy nearest-neighbour ordering of `items` starting from index 0. */
export function nearestNeighbour(m: Matrix, items: number[]): number[] {
  const left = new Set(items);
  const tour = [0];
  let cur = 0;
  while (left.size) {
    let best = -1;
    let bestD = Infinity;
    for (const c of left) {
      const d = at(m, cur, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best === -1) break; // the rest are unreachable
    tour.push(best);
    left.delete(best);
    cur = best;
  }
  return tour;
}

/** 2-opt: reverse segments while it shortens the tour. Keeps tour[0] fixed. */
export function twoOpt(m: Matrix, tour: number[], closed: boolean, maxRounds = 50): number[] {
  const t = [...tour];
  const n = t.length;
  if (n < 4 && !(n === 3 && !closed)) return t;
  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = t[i - 1];
        const b = t[i];
        const c = t[j];
        let delta: number;
        if (j === n - 1 && !closed) {
          delta = at(m, a, c) - at(m, a, b);
        } else {
          const d = j + 1 < n ? t[j + 1] : t[0];
          delta = at(m, a, c) + at(m, b, d) - at(m, a, b) - at(m, c, d);
        }
        if (delta < -1e-6) {
          for (let x = i, y = j; x < y; x++, y--) [t[x], t[y]] = [t[y], t[x]];
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return t;
}

/** Or-opt: move single stops to a better position while it shortens the tour. */
export function orOpt(m: Matrix, tour: number[], closed: boolean, maxRounds = 20): number[] {
  let t = [...tour];
  for (let round = 0; round < maxRounds; round++) {
    let improved = false;
    for (let i = 1; i < t.length; i++) {
      const before = tourLength(m, t, closed);
      const c = t[i];
      const rest = [...t.slice(0, i), ...t.slice(i + 1)];
      const { pos, delta } = bestInsertion(m, rest, c, closed);
      const after = tourLength(m, rest, closed) + delta;
      if (after < before - 1e-6) {
        rest.splice(pos, 0, c);
        t = rest;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return t;
}
