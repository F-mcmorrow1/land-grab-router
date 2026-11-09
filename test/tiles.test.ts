import { describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph/graph";
import { clip, repairJunctions, routable, toOsm, type RawSegments } from "../src/graph/tiles";

function raw(points: [number, number][], segs: [number, number][], grade: (number | null)[] = segs.map(() => 0)): RawSegments {
  // Somewhere in London at zoom 14.
  return { xs: points.map((p) => p[0]), ys: points.map((p) => p[1]), segs, grade, extent: 4096, originX: 8186 * 4096, originY: 5448 * 4096 };
}
const components = (r: RawSegments) => {
  const g = buildGraph(toOsm(r), 8);
  return g.componentSize.length;
};

describe("vector tile streets", () => {
  it("joins a side street whose junction vertex was simplified away", () => {
    // Main road (0)-(1) straight across; side street (2)-(3) ends on it at x=500 with no shared vertex.
    const r = raw([[0, 100], [1000, 100], [500, 400], [500, 101]], [[0, 1], [2, 3]]);
    expect(components(r)).toBe(2);
    repairJunctions(r);
    expect(components(r)).toBe(1);
  });

  it("joins streets crossing at street level but not a bridge over them", () => {
    const level = raw([[0, 0], [1000, 0], [500, -500], [500, 500]], [[0, 1], [2, 3]]);
    repairJunctions(level);
    expect(components(level)).toBe(1);
    const bridge = raw([[0, 0], [1000, 0], [500, -500], [500, 500]], [[0, 1], [2, 3]], [0, null]);
    repairJunctions(bridge);
    expect(components(bridge)).toBe(2);
  });

  it("leaves genuinely separate dead ends alone", () => {
    const r = raw([[0, 0], [1000, 0], [500, 300], [500, 60]], [[0, 1], [2, 3]]); // 60 units ≈ 22 m away
    repairJunctions(r);
    expect(components(r)).toBe(2);
  });

  it("clips segments to the tile", () => {
    expect(clip(-10, 50, 10, 50, 0, 0, 4096, 4096)).toEqual([0, 50, 10, 50]);
    expect(clip(-10, -10, -5, -5, 0, 0, 4096, 4096)).toBeNull();
  });

  it("filters ways by activity", () => {
    expect(routable({ class: "path", subclass: "footway" }, "foot")).toBe(true);
    expect(routable({ class: "path", subclass: "footway" }, "bike")).toBe(false);
    expect(routable({ class: "path", subclass: "footway", bicycle: "designated" }, "bike")).toBe(true);
    expect(routable({ class: "motorway" }, "foot")).toBe(false);
    expect(routable({ class: "minor", access: "no" }, "foot")).toBe(false);
    expect(routable({ class: "path", subclass: "platform" }, "foot")).toBe(false);
  });
});
