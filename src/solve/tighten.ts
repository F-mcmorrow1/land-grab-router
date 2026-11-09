import { dijkstra, extractPath, pathCells, type Path } from "../graph/dijkstra";
import { safeNodes, type RoadGraph } from "../graph/graph";

/** One stretch of route between consecutive stops, with the hexagons it counts. */
export interface Leg {
  path: Path;
  cells: Set<number>;
}

/**
 * The stops a route is built from. nodes[0] is the start; nodes[i] is the street node where
 * the route touches stop i, which is there for hexagon cells[i]. Leg i runs nodes[i] → nodes[i+1];
 * a closed route has one more leg, from the last stop back to the start.
 */
export interface Stops {
  nodes: number[];
  cells: number[];
  /** Stops that must stay even when the rest of the route seems to cover them. */
  pinned: boolean[];
}

export const reversePath = (p: Path): Path => ({ nodes: [...p.nodes].reverse(), slots: [...p.slots].reverse(), length: p.length });

const leg = (g: RoadGraph, path: Path): Leg => ({ path, cells: pathCells(g, path) });

export function legBetween(g: RoadGraph, a: number, b: number): Leg {
  if (a === b) return leg(g, { nodes: [a], slots: [], length: 0 });
  return leg(g, extractPath(dijkstra(g, a, { target: b }), b));
}

export function legsFor(g: RoadGraph, nodes: number[], closed: boolean): Leg[] {
  const out: Leg[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) out.push(legBetween(g, nodes[i], nodes[i + 1]));
  if (closed && nodes.length > 1) out.push(legBetween(g, nodes[nodes.length - 1], nodes[0]));
  return out;
}

export const routeLength = (legs: Leg[]) => legs.reduce((s, l) => s + l.path.length, 0);

function union(legs: Leg[], skip: Set<number>, extra: Leg[]): Set<number> {
  const out = new Set<number>();
  legs.forEach((l, i) => {
    if (!skip.has(i)) l.cells.forEach((c) => out.add(c));
  });
  extra.forEach((l) => l.cells.forEach((c) => out.add(c)));
  return out;
}

/**
 * Takes the slack out of a route without losing anything it earns. Each hexagon counts as soon
 * as the route is a safe distance inside it, so running on to a point deep inside is wasted:
 *
 * 1. Drop stops whose hexagon the rest of the route already gets.
 * 2. Move each stop to the point in its hexagon that's cheapest given where the route comes
 *    from and where it goes next (usually just inside the nearest edge).
 *
 * A change is kept only if `quality` of the hexagons crossed doesn't drop and the route gets
 * shorter. Repeats until nothing changes.
 */
export function tighten(
  g: RoadGraph,
  stops: Stops,
  legs: Leg[],
  closed: boolean,
  byCell: Map<number, number[]>,
  quality: (cells: Set<number>) => number,
  passes = 4,
): { stops: Stops; legs: Leg[] } {
  const nodes = [...stops.nodes];
  const cells = [...stops.cells];
  const pinned = [...stops.pinned];
  legs = [...legs];
  const nextOf = (p: number) => (p + 1 < nodes.length ? nodes[p + 1] : closed ? nodes[0] : -1);
  let q = quality(union(legs, new Set(), []));

  for (let pass = 0; pass < passes; pass++) {
    let changed = false;

    // 1. Drop stops that earn nothing on their own.
    for (let p = nodes.length - 1; p >= 1; p--) {
      if (pinned[p]) continue;
      const next = nextOf(p);
      const hasNext = next !== -1;
      const before = legs[p - 1].path.length + (hasNext ? legs[p].path.length : 0);
      const replacement = hasNext ? legBetween(g, nodes[p - 1], next) : null;
      if ((replacement?.path.length ?? 0) >= before - 0.5) continue;
      const nq = quality(union(legs, new Set(hasNext ? [p - 1, p] : [p - 1]), replacement ? [replacement] : []));
      if (nq < q - 1e-9) continue;
      legs.splice(p - 1, hasNext ? 2 : 1, ...(replacement ? [replacement] : []));
      nodes.splice(p, 1);
      cells.splice(p, 1);
      pinned.splice(p, 1);
      q = nq;
      changed = true;
    }

    // 2. Enter each stop's hexagon at the cheapest point.
    for (let p = 1; p < nodes.length; p++) {
      const next = nextOf(p);
      const hasNext = next !== -1;
      const before = legs[p - 1].path.length + (hasNext ? legs[p].path.length : 0);
      const fromPrev = dijkstra(g, nodes[p - 1], { maxDist: before });
      const fromNext = hasNext ? dijkstra(g, next, { maxDist: before }) : null;
      let best = nodes[p];
      let bestCost = before - 0.5;
      for (const v of safeNodes(g, byCell.get(cells[p]) ?? [nodes[p]])) {
        const cost = fromPrev.dist[v] + (fromNext ? fromNext.dist[v] : 0);
        if (cost < bestCost) {
          bestCost = cost;
          best = v;
        }
      }
      if (best === nodes[p]) continue;
      const inLeg = leg(g, extractPath(fromPrev, best));
      const outLeg = fromNext ? leg(g, reversePath(extractPath(fromNext, best))) : null;
      const fresh = outLeg ? [inLeg, outLeg] : [inLeg];
      const nq = quality(union(legs, new Set(hasNext ? [p - 1, p] : [p - 1]), fresh));
      if (nq < q - 1e-9) continue;
      legs.splice(p - 1, hasNext ? 2 : 1, ...fresh);
      nodes[p] = best;
      q = nq;
      changed = true;
    }

    if (!changed) break;
  }
  return { stops: { nodes, cells, pinned }, legs };
}
