import { describe, expect, it } from "vitest";
import { makeDemo } from "../src/data/demo";
import { parseLandGrab } from "../src/data/decode";
import type { RawLandGrab, RawTeam } from "../src/data/types";
import { checkTeam, OUR_TEAM } from "../src/team";

const week = (yourTeam: number, teams: RawTeam[] = [{ id: 7, name: "Paceholder Meeting" }, { id: 29, name: "Worst Pace Scenario", colour: "#f4f4ed" }]): RawLandGrab => ({
  teams,
  cells: [],
  activities: [],
  regions: [],
  your_team: yourTeam,
});

describe("team lock", () => {
  it("lets our team in and plans for us", () => {
    expect(checkTeam(parseLandGrab(week(1)))).toEqual({ ok: true, team: 1 });
  });

  it("turns away other teams, naming them", () => {
    expect(checkTeam(parseLandGrab(week(0)))).toEqual({ ok: false, theirTeam: "Paceholder Meeting" });
  });

  it("turns away data that isn't from anyone on a team", () => {
    expect(checkTeam(parseLandGrab(week(-1)))).toEqual({ ok: false, theirTeam: null });
  });

  it("goes by team ID, so a rival can't just rename themselves", () => {
    const impostor = week(0, [{ id: 7, name: "Worst Pace Scenario" }, { id: 29, name: "Worst Pace Scenario" }]);
    expect(checkTeam(parseLandGrab(impostor)).ok).toBe(false);
  });

  it("falls back to the name when the data has no team IDs", () => {
    expect(checkTeam(parseLandGrab(week(1, [{ name: "Others" }, { name: OUR_TEAM.name }])))).toEqual({ ok: true, team: 1 });
  });

  it("opens with the demo data", () => {
    expect(checkTeam(parseLandGrab(makeDemo({ lat: 51.5, lng: -0.12 }))).ok).toBe(true);
  });
});
