import { describe, expect, it } from "vitest";
import { nextStop, settle } from "../src/sheet";

// Offsets: how far the sheet is pushed down from fully open.
const stops = { full: 0, half: 300, peek: 640 };

describe("bottom sheet", () => {
  it("settles on the nearest stop after a slow drag", () => {
    expect(settle(40, 0, stops)).toBe("full");
    expect(settle(260, 0.1, stops)).toBe("half");
    expect(settle(600, -0.1, stops)).toBe("peek");
  });

  it("carries a flick on to the next stop in that direction", () => {
    expect(settle(560, -1.2, stops)).toBe("half"); // flick up from near peek
    expect(settle(280, -1.2, stops)).toBe("full");
    expect(settle(20, 1.5, stops)).toBe("half"); // flick down from near full
    expect(settle(320, 1.5, stops)).toBe("peek");
    expect(settle(640, 2, stops)).toBe("peek"); // can't go below peek
  });

  it("steps through the stops on a tap", () => {
    expect(nextStop("peek")).toBe("half");
    expect(nextStop("half")).toBe("full");
    expect(nextStop("full")).toBe("peek");
  });
});
