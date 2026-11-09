import { gridDisk, latLngToCell } from "h3-js";
import { describe, expect, it } from "vitest";
import { makeDemo } from "../src/data/demo";
import { parseLandGrab } from "../src/data/decode";
import { replay } from "../src/data/replay";
import type { RawLandGrab } from "../src/data/types";
import { DEFAULT_WEIGHTS, assess, projectRun } from "../src/scoring";

const home = latLngToCell(51.5, -0.12, 8);
const [A, B, C] = gridDisk(home, 1).filter((c) => c !== home);

function raw(activities: { team: number; minutes: number; cells: string[]; offsets?: number[] }[]): RawLandGrab {
  const cells = [...new Set(activities.flatMap((a) => a.cells))];
  return {
    teams: [{ name: "Us" }, { name: "Them" }, { name: "Others" }],
    cells,
    regions: [{ name: "Here", lat: 51.5, lng: -0.12, bounds: [-0.2, 51.45, -0.05, 51.55] }],
    activities: activities.map((a) => ({ ...a, region: 0, cells: a.cells.map((c) => cells.indexOf(c)) })),
    your_team: 0,
  };
}

describe("replay", () => {
  it("gives ties to whoever crossed first, and lets them win it back", () => {
    const acts = [
      { team: 0, minutes: 10, cells: [A] },
      { team: 1, minutes: 20, cells: [A] },
    ];
    expect(replay(parseLandGrab(raw(acts))).hexes.get(A)!.holder).toBe(0);
    acts.push({ team: 1, minutes: 30, cells: [A] });
    expect(replay(parseLandGrab(raw(acts))).hexes.get(A)!.holder).toBe(1);
    acts.push({ team: 0, minutes: 40, cells: [A] });
    expect(replay(parseLandGrab(raw(acts))).hexes.get(A)!.holder).toBe(0);
  });

  it("orders crossings by start time plus per-cell offsets", () => {
    const state = replay(
      parseLandGrab(
        raw([
          { team: 0, minutes: 100, cells: [A, B], offsets: [0, 50] },
          { team: 1, minutes: 120, cells: [B] },
        ]),
      ),
    );
    expect(state.hexes.get(A)!.holder).toBe(0);
    expect(state.hexes.get(B)!.holder).toBe(1); // team 1 got there at 120, team 0 at 150
    expect(state.held).toEqual([1, 1, 0]);
  });

  it("accepts the response wrapped in { data }", () => {
    const ds = parseLandGrab({ data: raw([{ team: 2, minutes: 5, cells: [C] }]) });
    expect(ds.resolution).toBe(8);
    expect(replay(ds).held).toEqual([0, 0, 1]);
  });
});

describe("scoring", () => {
  const w = { ...DEFAULT_WEIGHTS, leaderFocus: false };

  it("classifies each hexagon from your team's point of view", () => {
    const state = replay(
      parseLandGrab(
        raw([
          { team: 1, minutes: 10, cells: [A, B] }, // A: they lead 1-0. B: they lead 2-1.
          { team: 0, minutes: 20, cells: [B, C] }, // C: ours 1-1, we were first.
          { team: 1, minutes: 30, cells: [B, C] },
        ]),
      ),
    );
    expect(assess(state, 0, home, w).outcome).toBe("claim");
    expect(assess(state, 0, A, w)).toMatchObject({ outcome: "siege", crossingsNeeded: 2 });
    expect(assess(state, 0, B, w)).toMatchObject({ outcome: "siege", crossingsNeeded: 2 });
    expect(assess(state, 0, C, w)).toMatchObject({ outcome: "defend", crossingsNeeded: 1 });
    // From team 1's side: C is level and they were second, so one crossing takes it.
    expect(assess(state, 1, C, w)).toMatchObject({ outcome: "steal", rival: 0, value: w.claim + w.block });
  });

  it("predicts the standings the real rules produce after your run", () => {
    // Property check on generated weeks: project a run, then replay the week with that run added.
    for (let seed = 1; seed <= 12; seed++) {
      const week = makeDemo({ lat: 51.5, lng: -0.12 }, seed);
      const before = replay(parseLandGrab(week));
      const team = seed % 4;
      const known = [...before.hexes.keys()];
      const run = [...known.filter((_, i) => i % 3 === seed % 3), ...gridDisk(home, 6).slice(0, 15)];
      const proj = projectRun(before, team, run, DEFAULT_WEIGHTS);

      const cells = [...week.cells];
      const idx = run.map((c) => {
        const i = cells.indexOf(c);
        return i >= 0 ? i : cells.push(c) - 1;
      });
      const after = replay(
        parseLandGrab({
          ...week,
          cells,
          activities: [...week.activities, { team, region: 0, minutes: 6 * 1440 + 1439, cells: [...new Set(idx)] }],
        }),
      );
      expect(proj.heldAfter).toEqual(after.held);
    }
  });
});
