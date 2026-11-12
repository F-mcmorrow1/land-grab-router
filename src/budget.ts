/** The distance budget box: typed distances, and − / + steps to whole kilometres. */

export const MIN_KM = 1;
export const MAX_KM = 50;

/** Reads what someone typed: "8", "21.1", "8,5" or "10 km". Null if it isn't a distance. */
export function parseKm(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replace(/km$/, "").trim().replace(",", ".");
  if (!/^\d*\.?\d+$/.test(cleaned) && !/^\d+\.$/.test(cleaned)) return null;
  const km = parseFloat(cleaned);
  return Number.isFinite(km) && km > 0 ? km : null;
}

/** Rounds to a tenth and keeps it in range; `min` is raised when the route has to reach an end point. */
export const clampKm = (km: number, min = MIN_KM) => Math.min(MAX_KM, Math.max(min, Math.round(km * 10) / 10));

/** − goes to the whole kilometre below, + to the one above (7.3 → 7 or 8). */
export function stepKm(km: number, direction: 1 | -1, min = MIN_KM): number {
  const next = direction > 0 ? Math.floor(km + 1e-9) + 1 : Math.ceil(km - 1e-9) - 1;
  return clampKm(next, min);
}

/** The shortest budget that covers `metres`, rounded up to a tenth of a km so it always fits. */
export const floorKm = (metres: number) => Math.max(MIN_KM, Math.ceil(metres / 100 - 1e-9) / 10);

/** "8", "8.5", "21.1": no trailing zeros. */
export const formatKm = (km: number) => String(Math.round(km * 10) / 10);
