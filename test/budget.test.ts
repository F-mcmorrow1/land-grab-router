import { describe, expect, it } from "vitest";
import { clampKm, floorKm, formatKm, parseKm, stepKm } from "../src/budget";

describe("distance budget box", () => {
  it("reads distances however they're typed", () => {
    expect(parseKm("8")).toBe(8);
    expect(parseKm(" 21.1 ")).toBe(21.1);
    expect(parseKm("8,5")).toBe(8.5);
    expect(parseKm("10 km")).toBe(10);
    expect(parseKm("10KM")).toBe(10);
    expect(parseKm(".5")).toBe(0.5);
    expect(parseKm("8.")).toBe(8); // halfway through typing 8.5
  });

  it("rejects things that aren't distances", () => {
    for (const bad of ["", "abc", "-5", "0", "8..5", "1e3", "5 miles"]) expect(parseKm(bad)).toBeNull();
  });

  it("steps to whole kilometres and stays in range", () => {
    expect(stepKm(8, 1)).toBe(9);
    expect(stepKm(8, -1)).toBe(7);
    expect(stepKm(7.3, 1)).toBe(8);
    expect(stepKm(7.3, -1)).toBe(7);
    expect(stepKm(1, -1)).toBe(1);
    expect(stepKm(50, 1)).toBe(50);
    expect(clampKm(0.2)).toBe(1);
    expect(clampKm(80)).toBe(50);
    expect(clampKm(21.0975)).toBe(21.1);
  });

  it("never steps below the way to the end point", () => {
    expect(clampKm(3, 4.3)).toBe(4.3);
    expect(stepKm(4.8, -1, 4.3)).toBe(4.3);
    expect(stepKm(7.3, -1, 4.3)).toBe(7);
    expect(stepKm(4.3, 1, 4.3)).toBe(5);
  });

  it("rounds the way to the end point up, so the budget always covers it", () => {
    expect(floorKm(4210)).toBe(4.3);
    expect(floorKm(4200)).toBe(4.2);
    expect(floorKm(300)).toBe(1);
  });

  it("shows distances without trailing zeros", () => {
    expect(formatKm(8)).toBe("8");
    expect(formatKm(8.5)).toBe("8.5");
    expect(formatKm(21.1)).toBe("21.1");
  });
});
