import type { Dataset } from "./data/types";

/** The one team this planner works for. */
export const OUR_TEAM = { id: 29, name: "Worst Pace Scenario" } as const;

export type Verdict =
  /** Data from one of us: plan for this team index. */
  | { ok: true; team: number }
  /** Data from anyone else. `theirTeam` is their team's name, or null if the data names none. */
  | { ok: false; theirTeam: string | null };

const isOurs = (t: { id?: number; name: string }) => (t.id !== undefined ? t.id === OUR_TEAM.id : t.name === OUR_TEAM.name);

/**
 * Only data downloaded by a member of our team unlocks the planner (`your_team` points at us).
 * Planning is always for our team, so a rival holding a copy of our data would only plan
 * routes that help us.
 */
export function checkTeam(ds: Dataset): Verdict {
  const mine = ds.yourTeam >= 0 ? ds.teams[ds.yourTeam] : undefined;
  if (mine && isOurs(mine)) return { ok: true, team: ds.yourTeam };
  return { ok: false, theirTeam: mine?.name ?? null };
}
