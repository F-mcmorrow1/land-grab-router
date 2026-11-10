import { describe, expect, it } from "vitest";
import { planRoutes } from "../src/solve/multi";
import { grid } from "./grid";

describe("several routes in one sweep", () => {
  const { g, centre } = grid();
  const values = new Float64Array(g.cellIds.length).fill(1);

  it("plans complementary routes that each go for new ground", () => {
    const routes = planRoutes({ g, start: centre, budget: 5000, closed: true, values, count: 3 });
    expect(routes).toHaveLength(3);
    for (const r of routes) {
      expect(r.path.length).toBeLessThanOrEqual(5000 + 1e-6);
      expect(r.path.nodes[0]).toBe(centre);
      expect(r.path.nodes[r.path.nodes.length - 1]).toBe(centre);
    }
    // Later routes only score hexagons the earlier ones didn't reach.
    const seen = new Set<number>();
    for (const r of routes) {
      const fresh = [...r.cells].filter((c) => !seen.has(c)).length;
      expect(r.score).toBe(fresh);
      expect(fresh).toBeGreaterThan(0);
      r.cells.forEach((c) => seen.add(c));
    }
    // Together they cover far more than the first alone.
    expect(seen.size).toBeGreaterThan(routes[0].cells.size * 1.5);
  });

  it("doesn't change the values it was given", () => {
    planRoutes({ g, start: centre, budget: 4000, closed: true, values, count: 2 });
    expect(values.every((v) => v === 1)).toBe(true);
  });

  it("stops early when there's nothing left worth a run", () => {
    const tiny = new Float64Array(g.cellIds.length);
    tiny[g.cellOf[centre + 2]] = 1; // one prize next to the start
    const routes = planRoutes({ g, start: centre, budget: 4000, closed: true, values: tiny, count: 4 });
    expect(routes.length).toBeLessThan(4);
  });
});
