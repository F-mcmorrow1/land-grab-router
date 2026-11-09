import { dijkstra, extractPath, joinPaths, pathCells, type Path } from "../graph/dijkstra";
import { centreNode, nodesByCell, type RoadGraph } from "../graph/graph";
import { distanceMatrix, type Progress, type RouteResult } from "./common";
import { tighten, type Leg } from "./tighten";
import { at, bestInsertion, orOpt, tourLength, twoOpt, type Matrix } from "./tour";

export interface MaxScoreInput {
  g: RoadGraph;
  start: number;
  /** Longest route allowed, metres. */
  budget: number;
  /** Finish back at the start. */
  closed: boolean;
  /** Points for crossing each hexagon once (index into g.cellIds). */
  value: (cell: number) => number;
  /** Hexagons considered as targets; more is slower but can find better routes. */
  maxCandidates?: number;
  /** Set false to skip the tightening pass (for comparisons). */
  tighten?: boolean;
  onProgress?: Progress;
}

export interface MaxScoreResult extends RouteResult {
  score: number;
}

type Cand = { cell: number; rep: number; v: number; d: number };

/** A route built from matrix stops, before tightening. */
interface Draft {
  tour: number[];
  legs: Leg[];
  score: number;
  length: number;
}

interface Attempt {
  tour: number[];
  path: Path;
  cells: Set<number>;
  score: number;
}

/**
 * A prize-collecting route: as many points as possible within a distance budget,
 * where each hexagon pays out once however many times the route crosses it.
 * This is the orienteering problem (NP-hard), so it uses a heuristic:
 *
 * 1. Every hexagon with streets in range is a candidate, worth its points.
 * 2. Greedily insert the candidate with the best points per extra metre, while it fits.
 * 3. Tidy the order (2-opt, or-opt), then build the real street route and note every
 *    hexagon it passes through on the way: those are already won.
 * 4. Drop stops whose hexagon is already won by another part of the route, freeing
 *    distance, and go round again until the score stops improving.
 * 5. Tighten: stops are aimed at a street near each hexagon's middle, but a hexagon counts as
 *    soon as the route is safely inside it, so move each stop to the cheapest point in its
 *    hexagon and drop any the rest of the route already covers (see tighten.ts).
 * 6. Spend the distance that frees up on short out-and-back spurs into neighbouring hexagons.
 *
 * Greedy insertion tends to build compact blobs, so it is run from several starting
 * shapes (including loops pulled out towards each compass point); the two best are
 * tightened and filled, and the better result is kept.
 */
export function maxScore(inp: MaxScoreInput): MaxScoreResult {
  const { g, start, budget, closed, value, onProgress } = inp;
  const reach = closed ? budget / 2 : budget;
  const byCell = nodesByCell(g, g.component[start]);
  const startCell = g.cellOf[start];

  onProgress?.("Finding hexagons in range", 0.02);
  const fromStart = dijkstra(g, start, { maxDist: reach });
  let cands: Cand[] = [];
  byCell.forEach((nodes, cell) => {
    if (cell === startCell) return;
    const v = value(cell);
    if (!(v > 0)) return;
    const ok = nodes.filter((n) => fromStart.dist[n] <= reach && g.safe[n]);
    if (!ok.length) return;
    const rep = centreNode(g, cell, ok);
    cands.push({ cell, rep, v, d: fromStart.dist[rep] });
  });
  const rank = (c: Cand) => c.v / (1 + c.d / (budget / 4));
  cands.sort((a, b) => rank(b) - rank(a));
  cands = cands.slice(0, inp.maxCandidates ?? 150);

  const nodeOf = (i: number) => (i === 0 ? start : cands[i - 1].rep);
  const matrix = distanceMatrix(g, [start, ...cands.map((c) => c.rep)], (m, f) => onProgress?.(m, 0.05 + (f ?? 0) * 0.6), budget);

  const legCache = new Map<number, { path: Path; cells: Set<number> }>();
  const leg = (a: number, b: number) => {
    const key = a * matrix.k + b;
    let hit = legCache.get(key);
    if (!hit) {
      const path = extractPath(dijkstra(g, nodeOf(a), { target: nodeOf(b) }), nodeOf(b));
      hit = { path, cells: pathCells(g, path) };
      legCache.set(key, hit);
    }
    return hit;
  };
  const ctx: Ctx = { g, start, startCell, budget, closed, value, cands, matrix, leg, byCell, tighten: inp.tighten !== false };

  // Starting shapes: an empty tour with two levels of greed, plus loops seeded with a far
  // hexagon in each direction (a circular loop of length L reaches L/π from the start).
  const variants: { seed: number[]; smoothing: number }[] = [
    { seed: [], smoothing: 30 },
    { seed: [], smoothing: 400 },
  ];
  const ideal = closed ? budget / Math.PI : budget * 0.6;
  for (let q = 0; q < 4; q++) {
    let pick = -1;
    let pickErr = Infinity;
    for (let i = 1; i < matrix.k; i++) {
      const rep = cands[i - 1].rep;
      const bearing = Math.atan2(g.lat[rep] - g.lat[start], (g.lng[rep] - g.lng[start]) * Math.cos((g.lat[start] * Math.PI) / 180));
      const quadrant = Math.floor(((bearing + Math.PI * 2.25) % (Math.PI * 2)) / (Math.PI / 2));
      const err = Math.abs(at(matrix, 0, i) - ideal);
      if (quadrant === q && err < pickErr && tourLength(matrix, [0, i], closed) <= budget) {
        pickErr = err;
        pick = i;
      }
    }
    if (pick !== -1) variants.push({ seed: [pick], smoothing: 30 });
  }

  const drafts = variants.map((v, n) => {
    onProgress?.(`Trying route shapes (${n + 1}/${variants.length})`, 0.7 + (0.2 * n) / variants.length);
    return build(ctx, v.seed, v.smoothing);
  });
  drafts.sort((a, b) => b.score - a.score || a.length - b.length);

  let best: Attempt | null = null;
  for (const draft of drafts.slice(0, 2)) {
    onProgress?.("Trimming wasted distance", 0.92);
    const attempt = finish(ctx, draft);
    if (!best || attempt.score > best.score + 1e-9 || (Math.abs(attempt.score - best.score) <= 1e-9 && attempt.path.length < best.path.length)) {
      best = attempt;
    }
  }
  const winner = best as unknown as Attempt;
  return {
    path: winner.path,
    cells: winner.cells,
    targets: winner.tour.slice(1).map((i) => cands[i - 1].cell),
    unreachable: [],
    score: winner.score,
  };
}

interface Ctx {
  g: RoadGraph;
  start: number;
  startCell: number;
  budget: number;
  closed: boolean;
  value: (cell: number) => number;
  cands: Cand[];
  matrix: Matrix;
  leg: (a: number, b: number) => { path: Path; cells: Set<number> };
  byCell: Map<number, number[]>;
  tighten: boolean;
}

function build(ctx: Ctx, seed: number[], smoothing: number): Draft {
  const { startCell, budget, closed, value, cands, matrix, leg } = ctx;
  const score = (cells: Set<number>) => {
    let s = 0;
    cells.forEach((c) => (s += Math.max(0, value(c))));
    return s;
  };

  let tour = [0, ...seed];
  let len = tourLength(matrix, tour, closed);
  let legs: { path: Path; cells: Set<number> }[] = [];
  const inTour = new Set<number>(seed);
  let covered = new Set<number>([startCell, ...seed.map((i) => cands[i - 1].cell)]);

  const insertGreedy = () => {
    for (;;) {
      let pick: { i: number; pos: number; delta: number; ratio: number } | null = null;
      for (let i = 1; i < matrix.k; i++) {
        if (inTour.has(i) || covered.has(cands[i - 1].cell)) continue;
        const { pos, delta } = bestInsertion(matrix, tour, i, closed);
        if (!Number.isFinite(delta) || len + delta > budget) continue;
        const ratio = cands[i - 1].v / (Math.max(delta, 0) + smoothing);
        if (!pick || ratio > pick.ratio) pick = { i, pos, delta, ratio };
      }
      if (!pick) return;
      tour.splice(pick.pos, 0, pick.i);
      inTour.add(pick.i);
      len += pick.delta;
      covered.add(cands[pick.i - 1].cell);
    }
  };

  const stitch = () => {
    const stops = closed ? [...tour, 0] : tour;
    legs = [];
    for (let i = 0; i + 1 < stops.length; i++) legs.push(leg(stops[i], stops[i + 1]));
    covered = new Set([startCell]);
    legs.forEach((l) => l.cells.forEach((c) => covered.add(c)));
  };

  /** Remove stops that no longer earn anything on their own. */
  const prune = () => {
    const byValue = tour.slice(1).sort((x, y) => cands[x - 1].v - cands[y - 1].v);
    for (const t of byValue) {
      const p = tour.indexOf(t);
      const hasNext = p + 1 < tour.length || closed;
      const a = tour[p - 1];
      const b = p + 1 < tour.length ? tour[p + 1] : 0;
      const saved = at(matrix, a, t) + (hasNext ? at(matrix, t, b) - at(matrix, a, b) : 0);
      if (!(saved > 1)) continue;
      const replacement = hasNext ? leg(a, b) : null;
      const newCells = new Set<number>([startCell]);
      legs.forEach((l, li) => {
        if (li !== p - 1 && li !== p) l.cells.forEach((c) => newCells.add(c));
      });
      replacement?.cells.forEach((c) => newCells.add(c));
      if (score(newCells) < score(covered) - 1e-9) continue;
      tour.splice(p, 1);
      inTour.delete(t);
      len -= saved;
      legs.splice(p - 1, hasNext ? 2 : 1, ...(replacement ? [replacement] : []));
      covered = newCells;
    }
  };

  let best = { score: -1, tour: [0], legs: [] as { path: Path; cells: Set<number> }[], covered: new Set<number>([startCell]) };
  for (let round = 0; round < 5; round++) {
    insertGreedy();
    tour = twoOpt(matrix, orOpt(matrix, twoOpt(matrix, tour, closed), closed), closed);
    len = tourLength(matrix, tour, closed);
    stitch();
    prune();
    const s = score(covered);
    if (s > best.score + 1e-9) best = { score: s, tour: [...tour], legs: [...legs], covered: new Set(covered) };
    else break;
  }

  return { tour: best.tour, legs: best.legs, score: best.score, length: best.legs.reduce((s, l) => s + l.path.length, 0) };
}

/** Tighten a draft, then spend the distance that frees up on spurs. */
function finish(ctx: Ctx, draft: Draft): Attempt {
  const { g, start, startCell, budget, closed, value, cands, byCell } = ctx;
  const score = (cells: Set<number>) => {
    let s = 0;
    cells.forEach((c) => (s += Math.max(0, value(c))));
    return s;
  };
  const stops = {
    nodes: draft.tour.map((i) => (i === 0 ? start : cands[i - 1].rep)),
    cells: draft.tour.map((i) => (i === 0 ? startCell : cands[i - 1].cell)),
    pinned: draft.tour.map(() => false),
  };
  const tight = ctx.tighten ? tighten(g, stops, draft.legs, closed, byCell, score) : { legs: draft.legs };
  let path = tight.legs.length ? joinPaths(tight.legs.map((l) => l.path)) : { nodes: [start], slots: [], length: 0 };
  path = fillWithSpurs(g, path, pathCells(g, path), budget - path.length, value, byCell);
  const cells = pathCells(g, path);
  return { tour: draft.tour, path, cells, score: score(cells) };
}

/**
 * Spends leftover distance on out-and-back spurs from the route into nearby hexagons.
 * Stops are aimed at a street near each hexagon's middle, but clipping a hexagon's edge
 * is often much cheaper, so this usually picks up a few more.
 */
function fillWithSpurs(
  g: RoadGraph,
  route: Path,
  covered: Set<number>,
  spare: number,
  value: (cell: number) => number,
  byCell: Map<number, number[]>,
): Path {
  let path = route;
  const have = new Set(covered);
  for (let guard = 0; guard < 200 && spare > 20; guard++) {
    const sp = dijkstra(g, [...new Set(path.nodes)], { maxDist: spare / 2 });
    let best: { node: number; cost: number; ratio: number } | null = null;
    byCell.forEach((nodes, cell) => {
      if (have.has(cell)) return;
      const v = value(cell);
      if (!(v > 0)) return;
      for (const n of nodes) {
        if (!g.safe[n]) continue;
        const cost = 2 * sp.dist[n];
        if (!(cost <= spare)) continue;
        const ratio = v / (cost + 30);
        if (!best || ratio > best.ratio) best = { node: n, cost, ratio };
      }
    });
    if (!best) break;
    const { node, cost } = best as { node: number; cost: number };
    const spur = extractPath(sp, node);
    const at = path.nodes.indexOf(spur.nodes[0]);
    const back = [...spur.nodes].reverse();
    path = {
      nodes: [...path.nodes.slice(0, at + 1), ...spur.nodes.slice(1), ...back.slice(1), ...path.nodes.slice(at + 1)],
      // Slots only identify segments for hexagon coverage; direction doesn't matter.
      slots: [...path.slots.slice(0, at), ...spur.slots, ...[...spur.slots].reverse(), ...path.slots.slice(at)],
      length: path.length + cost,
    };
    pathCells(g, spur, have);
    spare -= cost;
  }
  return path;
}
