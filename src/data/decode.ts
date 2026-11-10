import { getResolution, isValidCell } from "h3-js";
import type { Activity, Dataset, RawLandGrab, Team } from "./types";

/** The site's fallback palette (first entry is the "your team" lime). */
export const PALETTE = [
  "#d2ff00", "#f4f4ed", "#8aa4c2", "#cf8662", "#c79aa8", "#c8b27a",
  "#a79bc4", "#7fb0a8", "#a8604f", "#6f8296", "#a8998a", "#8f6f8c",
];

const isHex = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c);

/** Keep valid team colours, fill the rest from the palette, and give your team lime when it has none. */
export function assignColours(colours: (string | null | undefined)[], yourTeam: number): string[] {
  const used = new Set(colours.filter(isHex).map((c) => c.toLowerCase()));
  const free = PALETTE.filter((c) => !used.has(c));
  return colours.map((c, i) => {
    if (isHex(c)) return c;
    if (i === yourTeam && free.includes(PALETTE[0])) {
      free.splice(free.indexOf(PALETTE[0]), 1);
      return PALETTE[0];
    }
    const pick = free.find((f) => yourTeam < 0 || f !== PALETTE[0]) ?? PALETTE[i % PALETTE.length];
    if (free.includes(pick)) free.splice(free.indexOf(pick), 1);
    return pick;
  });
}

function fail(msg: string): never {
  throw new Error(`That doesn't look like land-grab data: ${msg}`);
}

/**
 * Accepts the land-grab JSON as returned by the API (or wrapped in `{ data: ... }`)
 * and returns a validated, normalised dataset.
 */
export function parseLandGrab(input: unknown): Dataset {
  let raw = input as RawLandGrab & { data?: RawLandGrab };
  if (typeof input === "string") raw = JSON.parse(input);
  if (raw && !Array.isArray(raw.teams) && raw.data) raw = raw.data as typeof raw;
  if (!raw || typeof raw !== "object") fail("expected a JSON object");
  if (!Array.isArray(raw.teams)) fail("missing `teams`");
  if (!Array.isArray(raw.cells)) fail("missing `cells`");
  if (!Array.isArray(raw.activities)) fail("missing `activities`");

  const yourTeam = typeof raw.your_team === "number" && raw.your_team < raw.teams.length ? raw.your_team : -1;
  const colours = assignColours(raw.teams.map((t) => t.colour), yourTeam);
  const teams: Team[] = raw.teams.map((t, i) => ({
    ...(typeof t.id === "number" ? { id: t.id } : {}),
    name: t.name || `Team ${i + 1}`,
    colour: colours[i],
  }));

  const firstValid = raw.cells.find((c) => isValidCell(c));
  const resolution = firstValid ? getResolution(firstValid) : 8;

  const activities: Activity[] = raw.activities.map((a, i) => {
    if (!Array.isArray(a.cells)) fail(`activity ${i} has no cells`);
    const minutes = Math.max(0, a.minutes | 0);
    // The site caps the day at Sunday and keeps the minute-of-day.
    const start = 1440 * Math.min(6, Math.floor(minutes / 1440)) + (minutes % 1440);
    return {
      athlete: a.athlete || "Someone",
      team: a.team,
      region: a.region ?? 0,
      start,
      cells: a.cells.map((ci) => raw.cells[ci]).filter((c): c is string => typeof c === "string"),
      offsets: Array.isArray(a.offsets) ? a.offsets : [],
      mine: Boolean(a.mine),
    };
  });

  return {
    teams,
    regions: Array.isArray(raw.regions) ? raw.regions : [],
    activities,
    yourTeam,
    yourRegion: typeof raw.your_region === "number" ? raw.your_region : 0,
    today: typeof raw.today === "number" ? raw.today : 0,
    resolution,
  };
}
