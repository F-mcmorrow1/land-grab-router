import { cellArea, cellToBoundary, cellToLatLng, latLngToCell, UNITS } from "h3-js";
import { describe, expect, it } from "vitest";
import { haversine } from "../src/graph/graph";
import { circleRing, depthInCell, distanceToRoute, headingWedge } from "../src/live";

const cell = latLngToCell(51.5, -0.12, 8);
const [clat, clng] = cellToLatLng(cell);

describe("live location geometry", () => {
  it("measures how far inside a hexagon you are", () => {
    // At the centre you're about one inradius from the nearest edge (H3 hexagons are slightly irregular).
    const inradius = (Math.sqrt((2 * cellArea(cell, UNITS.m2)) / (3 * Math.sqrt(3))) * Math.sqrt(3)) / 2;
    expect(depthInCell(cell, clat, clng)).toBeGreaterThan(inradius * 0.9);
    // Just inside a corner you're only a few metres in.
    const [vlat, vlng] = cellToBoundary(cell)[0];
    const near = [vlat + (clat - vlat) * 0.01, vlng + (clng - vlng) * 0.01] as const;
    expect(depthInCell(cell, near[0], near[1])).toBeLessThan(6);
  });

  it("measures distance to the route line", () => {
    const route: [number, number][] = [
      [-0.13, 51.5],
      [-0.11, 51.5],
    ];
    expect(distanceToRoute(route, 51.5, -0.12)).toBeLessThan(0.5);
    const north = 51.5 + 100 / 111_195; // ~100 m north of the line
    expect(distanceToRoute(route, north, -0.12)).toBeCloseTo(100, 0);
    expect(distanceToRoute([], 51.5, -0.12)).toBe(Infinity);
  });

  it("draws an accuracy circle of the right size and a wedge that points the right way", () => {
    for (const [lng, lat] of circleRing(51.5, -0.12, 50)) expect(haversine(51.5, -0.12, lat, lng)).toBeCloseTo(50, 0);
    const tip = headingWedge(51.5, -0.12, 90)[2]; // east
    expect(tip[0]).toBeGreaterThan(-0.12);
    expect(Math.abs(tip[1] - 51.5)).toBeLessThan(1e-6);
  });
});
