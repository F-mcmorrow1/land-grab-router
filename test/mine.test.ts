import { latLngToCell, gridDisk } from "h3-js";
import { describe, expect, it } from "vitest";
import { parseLandGrab } from "../src/data/decode";
import { crossedByMe } from "../src/data/mine";
import type { RawLandGrab } from "../src/data/types";
import { maxScore } from "../src/solve/maxScore";
import { grid } from "./grid";

const [A, B, C, D] = gridDisk(latLngToCell(51.5, -0.12, 8), 1);

const week: RawLandGrab = {
  teams: [{ id: 29, name: "Worst Pace Scenario" }, { id: 2, name: "Others" }],
  cells: [A, B, C, D],
  regions: [],
  activities: [
    { team: 0, region: 0, minutes: 1440 * 1 + 600, cells: [0, 1], mine: true }, // Tuesday, mine
    { team: 0, region: 0, minutes: 1440 * 3 + 20, cells: [2], offsets: [0], mine: true }, // Thursday, mine
    { team: 0, region: 0, minutes: 1440 * 3 + 30, cells: [3] }, // Thursday, a teammate's
  ],
  your_team: 0,
  today: 3,
};

describe("hexagons you've already crossed", () => {
  const ds = parseLandGrab(week);

  it("finds your own crossings for the week or just today", () => {
    expect([...crossedByMe(ds, "week")].sort()).toEqual([A, B, C].sort());
    expect([...crossedByMe(ds, "today")]).toEqual([C]);
    expect(crossedByMe(ds, "off").size).toBe(0);
  });

  it("uses each cell's own crossing time, not just when the activity started", () => {
    // An activity that starts at 23:50 on Wednesday and crosses B after midnight.
    const late = parseLandGrab({ ...week, activities: [{ team: 0, region: 0, minutes: 1440 * 2 + 1430, cells: [0, 1], offsets: [0, 20], mine: true }] });
    expect([...crossedByMe(late, "today")]).toEqual([B]);
  });

  it("steers routes away from hexagons worth nothing", () => {
    const { g, centre } = grid();
    // Pretend you've crossed everything west of the start.
    const west = new Set<number>();
    for (let v = 0; v < 31 * 31; v++) if (v % 31 < 13) west.add(g.cellOf[v]);
    const westCovered = (cells: Set<number>) => [...cells].filter((c) => west.has(c)).length;

    const normal = maxScore({ g, start: centre, budget: 7000, closed: true, value: () => 1 });
    const skipping = maxScore({ g, start: centre, budget: 7000, closed: true, value: (c) => (west.has(c) ? 0 : 1) });
    expect(westCovered(skipping.cells)).toBeLessThan(westCovered(normal.cells));
    // Points only come from the hexagons that still count.
    expect(skipping.score).toBe([...skipping.cells].filter((c) => !west.has(c)).length);
  });
});
