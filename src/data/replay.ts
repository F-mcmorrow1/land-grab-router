import type { Crossing, Dataset, GameState, HexState } from "./types";

/**
 * Rebuilds who holds each hexagon, using the same rules as strods.uk:
 *
 * - Every crossing of a hexagon adds one visit for the crossing athlete's team.
 * - Crossings are replayed in time order across the whole week.
 * - A team takes a hexagon when it has more visits than the holder, or the same number
 *   and it crossed the hexagon first.
 */
export function replay(ds: Dataset, upTo = ds.activities.length): GameState {
  const crossings: Crossing[] = [];
  const n = Math.min(upTo, ds.activities.length);
  for (let a = 0; a < n; a++) {
    const act = ds.activities[a];
    act.cells.forEach((cell, i) => crossings.push({ activity: a, cell, at: act.start + (act.offsets[i] ?? 0) }));
  }
  crossings.sort((x, y) => x.at - y.at); // Array#sort is stable, matching the site.

  const teamCount = ds.teams.length;
  const hexes = new Map<string, HexState>();
  crossings.forEach(({ activity, cell, at }, order) => {
    const { team, region } = ds.activities[activity];
    let h = hexes.get(cell);
    if (!h) {
      h = {
        cell,
        visits: new Array(teamCount).fill(0),
        firsts: new Array(teamCount).fill(Infinity),
        holder: -1,
        region,
        lastCrossedAt: at,
      };
      hexes.set(cell, h);
    }
    const v = ++h.visits[team];
    if (h.firsts[team] === Infinity) h.firsts[team] = order;
    h.lastCrossedAt = at;
    if (h.holder === team) return;
    const m = h.holder;
    if (m === -1 || v > h.visits[m] || (v === h.visits[m] && h.firsts[team] < h.firsts[m])) h.holder = team;
  });

  const held = new Array(teamCount).fill(0);
  hexes.forEach((h) => {
    if (h.holder >= 0) held[h.holder]++;
  });
  return { hexes, held, order: crossings.length };
}

/** The strongest rival of the holder, or -1. Used for the site's "contested" dots and opacity. */
export function runnerUp(h: HexState): number {
  let best = -1;
  h.visits.forEach((v, t) => {
    if (t !== h.holder && v > 0 && (best === -1 || v > h.visits[best])) best = t;
  });
  return best;
}

/** How firmly the holder holds it: visits ahead of the runner-up. */
export function lead(h: HexState): number {
  const r = runnerUp(h);
  return h.visits[h.holder] - (r === -1 ? 0 : h.visits[r]);
}
