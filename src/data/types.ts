/**
 * Shapes of the strods.uk land-grab data.
 *
 * `RawLandGrab` is the JSON returned by `GET https://api.strods.uk/clubs/{clubId}/land-grab`,
 * as read from the site's own decoder. Every field the planner relies on is listed here;
 * anything else in the response is ignored.
 */

export interface RawTeam {
  name: string;
  /** `#rrggbb`. The site falls back to its own palette when missing or invalid. */
  colour?: string | null;
}

export interface RawRegion {
  name: string;
  lat: number;
  lng: number;
  /** [west, south, east, north] */
  bounds: [number, number, number, number];
}

export interface RawActivity {
  athlete?: string | null;
  /** Index into `teams`. */
  team: number;
  /** Index into `regions`. */
  region: number;
  /** Minutes since Monday 00:00 (Europe/London) of the current week. */
  minutes: number;
  /** Indexes into the top-level `cells` array, in the order the route crossed them. */
  cells: number[];
  /** Optional minute offset per crossed cell, added to `minutes`. */
  offsets?: number[] | null;
  /** True when the signed-in athlete recorded it. */
  mine?: boolean;
}

export interface RawLandGrab {
  teams: RawTeam[];
  /** H3 cell IDs (resolution 8 on strods.uk). */
  cells: string[];
  activities: RawActivity[];
  regions: RawRegion[];
  /** Index into `teams`, or -1 when signed out / not on a team. */
  your_team?: number;
  your_region?: number;
  /** Day of the week, 0 = Monday. */
  today?: number;
}

export interface Team {
  name: string;
  colour: string;
}

export interface Crossing {
  activity: number;
  cell: string;
  /** Minutes since Monday 00:00. */
  at: number;
}

export interface Activity {
  athlete: string;
  team: number;
  region: number;
  /** Minutes since Monday 00:00. */
  start: number;
  cells: string[];
  offsets: number[];
  mine: boolean;
}

export interface Dataset {
  teams: Team[];
  regions: RawRegion[];
  activities: Activity[];
  yourTeam: number;
  yourRegion: number;
  today: number;
  /** H3 resolution of the game's cells. */
  resolution: number;
}

export interface HexState {
  cell: string;
  /** Crossings per team this week. */
  visits: number[];
  /** Global order of each team's first crossing (Infinity if never). Breaks ties. */
  firsts: number[];
  /** Team index holding the hexagon. */
  holder: number;
  region: number;
  lastCrossedAt: number;
}

export interface GameState {
  hexes: Map<string, HexState>;
  /** Hexagons held per team. */
  held: number[];
  /** Number of crossings replayed; the next crossing gets this order number. */
  order: number;
}
