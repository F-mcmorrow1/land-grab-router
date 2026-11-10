import type { RoadGraph } from "../graph/graph";
import type { Progress } from "./common";
import { maxScore, type MaxScoreResult } from "./maxScore";

export interface PlanRoutesInput {
  g: RoadGraph;
  start: number;
  budget: number;
  closed: boolean;
  /** Points for each hexagon (index into g.cellIds). Not modified. */
  values: Float64Array;
  /** Routes wanted, 1–5. */
  count: number;
  onProgress?: Progress;
}

/**
 * Plans up to `count` routes from the same start, one after another. Each later route treats
 * the hexagons earlier ones cover as already taken (worth nothing), so together they cover as
 * much new ground as possible: a set of runs for different days. Stops early if there's nothing
 * left worth a run.
 */
export function planRoutes({ g, start, budget, closed, values, count, onProgress }: PlanRoutesInput): MaxScoreResult[] {
  const left = Float64Array.from(values);
  const n = Math.max(1, Math.min(5, Math.floor(count)));
  const routes: MaxScoreResult[] = [];
  for (let i = 0; i < n; i++) {
    const label = n > 1 ? `Route ${i + 1} of ${n}: ` : "";
    const r = maxScore({ g, start, budget, closed, value: (c) => left[c], onProgress: (m, f) => onProgress?.(label + m, f) });
    if (routes.length && !(r.score > 0)) break;
    routes.push(r);
    r.cells.forEach((c) => (left[c] = 0));
  }
  return routes;
}
