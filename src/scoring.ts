import type { GameState, HexState } from "./data/types";

/**
 * What one more run by your team does to a hexagon it crosses (counted once per run).
 *
 * - claim:  nobody holds it, so you take it.
 * - steal:  a rival holds it and one crossing is enough to take it off them.
 * - siege:  a rival holds it firmly; this run gets you closer but doesn't take it.
 * - defend: you hold it but a rival could take it with one or two crossings.
 * - secure: you already hold it comfortably.
 */
export type Outcome = "claim" | "steal" | "siege" | "defend" | "secure";

export interface Weights {
  /** Points for a hexagon you take (claim or steal). */
  claim: number;
  /** Extra points for each hexagon taken off a rival (blocking their score). */
  block: number;
  /** Points for shoring up a hexagon you could lose to a single crossing. */
  defend: number;
  /** Points for progress on a hexagon you can take on the next run. */
  siege: number;
  /** Weight steals by how far each rival is ahead, so the leaders lose most. */
  leaderFocus: boolean;
}

export const DEFAULT_WEIGHTS: Weights = { claim: 1, block: 1, defend: 0.5, siege: 0.25, leaderFocus: true };

export interface HexPlan {
  cell: string;
  outcome: Outcome;
  value: number;
  /** For steal / siege: the team holding it. */
  rival?: number;
  /** Crossings your team needs to take it (siege) or a rival needs to take it (defend). */
  crossingsNeeded?: number;
}

/** Crossings `team` needs before it takes `h` from its holder (0 if it already holds it). */
export function crossingsToTake(h: HexState, team: number): number {
  if (h.holder === -1) return 1;
  if (h.holder === team) return 0;
  const gap = h.visits[h.holder] - h.visits[team];
  const wasFirst = h.firsts[team] < h.firsts[h.holder];
  return Math.max(1, gap + (wasFirst ? 0 : 1));
}

/** The fewest crossings any rival needs to take `h` off its holder. */
export function crossingsToLose(h: HexState): number {
  let best = Infinity;
  h.visits.forEach((_, r) => {
    if (r !== h.holder) best = Math.min(best, crossingsToTake(h, r));
  });
  return best;
}

function rivalFactor(state: GameState, team: number, rival: number, w: Weights): number {
  if (!w.leaderFocus) return 1;
  const rivals = state.held.filter((_, i) => i !== team);
  const mean = rivals.reduce((a, b) => a + b, 0) / Math.max(rivals.length, 1);
  if (mean <= 0) return 1;
  return Math.min(2, Math.max(0.25, state.held[rival] / mean));
}

/** What crossing `cell` once more would do for `team`. */
export function assess(state: GameState, team: number, cell: string, w: Weights): HexPlan {
  const h = state.hexes.get(cell);
  if (!h || h.holder === -1) return { cell, outcome: "claim", value: w.claim };

  if (h.holder === team) {
    // After our crossing a rival needs one more crossing than they do now.
    const toLose = crossingsToLose(h);
    if (toLose <= 2) return { cell, outcome: "defend", value: w.defend * (toLose === 1 ? 1 : 0.35), crossingsNeeded: toLose };
    return { cell, outcome: "secure", value: w.defend * 0.05, crossingsNeeded: toLose };
  }

  const need = crossingsToTake(h, team);
  if (need <= 1) {
    return { cell, outcome: "steal", value: w.claim + w.block * rivalFactor(state, team, h.holder, w), rival: h.holder };
  }
  return { cell, outcome: "siege", value: w.siege / (need - 1), rival: h.holder, crossingsNeeded: need };
}

/** Values for every hexagon already in play. Hexagons not listed are unclaimed and worth `w.claim`. */
export function valueTable(state: GameState, team: number, w: Weights): Map<string, HexPlan> {
  const out = new Map<string, HexPlan>();
  state.hexes.forEach((_, cell) => out.set(cell, assess(state, team, cell, w)));
  return out;
}

export interface Projection {
  plans: HexPlan[];
  counts: Record<Outcome, number>;
  /** Hexagons taken from each team. */
  stolenFrom: number[];
  heldBefore: number[];
  heldAfter: number[];
  points: number;
}

/** Projects the effect of one run by `team` that crosses `cells`. */
export function projectRun(state: GameState, team: number, cells: Iterable<string>, w: Weights): Projection {
  const counts: Record<Outcome, number> = { claim: 0, steal: 0, siege: 0, defend: 0, secure: 0 };
  const stolenFrom = state.held.map(() => 0);
  const heldAfter = [...state.held];
  const plans: HexPlan[] = [];
  let points = 0;
  for (const cell of new Set(cells)) {
    const p = assess(state, team, cell, w);
    plans.push(p);
    counts[p.outcome]++;
    points += p.value;
    if (p.outcome === "claim" || p.outcome === "steal") heldAfter[team]++;
    if (p.outcome === "steal" && p.rival !== undefined) {
      heldAfter[p.rival]--;
      stolenFrom[p.rival]++;
    }
  }
  return { plans, counts, stolenFrom, heldBefore: [...state.held], heldAfter, points };
}
