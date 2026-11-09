import { describe, expect, it } from "vitest";
import { joinPaths, pathCells } from "../src/graph/dijkstra";
import { centreNode, distanceToEdge, nodesByCell } from "../src/graph/graph";
import { maxScore } from "../src/solve/maxScore";
import { legsFor, routeLength, tighten } from "../src/solve/tighten";
import { visitAll } from "../src/solve/visitAll";
import { cellToBoundary, cellToLatLng } from "h3-js";
import { grid } from "./grid";

const { g, centre } = grid();
const byCell = nodesByCell(g, g.component[centre]);

/** How far into hexagon `cell` (metres from its nearest edge) the path's deepest point is. */
function depth(cell: number, nodes: number[]): number {
  const id = g.cellIds[cell];
  const [clat, clng] = cellToLatLng(id);
  const kx = 6_371_008.8 * (Math.PI / 180) * Math.cos((clat * Math.PI) / 180);
  const ky = 6_371_008.8 * (Math.PI / 180);
  const ring = cellToBoundary(id);
  const xs = ring.map(([, lng]) => (lng - clng) * kx);
  const ys = ring.map(([lat]) => (lat - clat) * ky);
  let deepest = 0;
  for (const v of nodes) {
    if (g.cellOf[v] === cell) deepest = Math.max(deepest, distanceToEdge(xs, ys, (g.lng[v] - clng) * kx, (g.lat[v] - clat) * ky));
  }
  return deepest;
}

describe("tighten", () => {
  it("shortens a route aimed at hexagon centres without losing any of them", () => {
    const cells = [...byCell.keys()].filter((c) => c !== g.cellOf[centre]).slice(0, 5);
    const stops = { nodes: [centre, ...cells.map((c) => centreNode(g, c, byCell.get(c)!))], cells: [g.cellOf[centre], ...cells], pinned: [true, ...cells.map(() => false)] };
    const legs = legsFor(g, stops.nodes, true);
    const count = (s: Set<number>) => cells.filter((c) => s.has(c)).length;
    const before = routeLength(legs);
    const all = (ls: typeof legs) => pathCells(g, joinPaths(ls.map((l) => l.path)));
    expect(count(all(legs))).toBe(cells.length);

    const tight = tighten(g, stops, legs, true, byCell, count);
    expect(count(all(tight.legs))).toBe(cells.length);
    expect(routeLength(tight.legs)).toBeLessThan(before * 0.95);
  });

  it("enters a chosen hexagon only as far as it needs to", () => {
    // A hexagon a couple along from the start: a centre-aimed route would go ~400 m deep.
    const target = g.cellOf[3 * 31 + 15];
    const r = visitAll({ g, start: centre, targets: [g.cellIds[target]], closed: false });
    expect(r.cells.has(target)).toBe(true);
    // At least the 15 m margin, but no more than one 120 m block past it.
    expect(depth(target, r.path.nodes)).toBeGreaterThanOrEqual(15);
    expect(depth(target, r.path.nodes)).toBeLessThan(15 + 120 + 1);
  });

  it("never makes max-points routes worse than an untightened run would be", () => {
    for (const budget of [3000, 6000, 9000]) {
      const r = maxScore({ g, start: centre, budget, closed: true, value: (c) => 1 + (c % 3) });
      expect(r.path.length).toBeLessThanOrEqual(budget + 1e-6);
      expect(r.score).toBe([...pathCells(g, r.path)].reduce((s, c) => s + 1 + (c % 3), 0));
    }
  });
});
