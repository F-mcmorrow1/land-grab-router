import type { Dataset } from "./types";

/** Which of your own past crossings to leave out of new routes. */
export type SkipMine = "week" | "today" | "off";

/**
 * Hexagons you (the athlete whose data this is) have crossed: every hexagon on your activities
 * this week, or only those you crossed today. The site marks your activities with `mine`.
 */
export function crossedByMe(ds: Dataset, scope: SkipMine): Set<string> {
  const out = new Set<string>();
  if (scope === "off") return out;
  for (const act of ds.activities) {
    if (!act.mine) continue;
    act.cells.forEach((cell, i) => {
      const day = Math.min(6, Math.floor((act.start + (act.offsets[i] ?? 0)) / 1440));
      if (scope === "week" || day === ds.today) out.add(cell);
    });
  }
  return out;
}
