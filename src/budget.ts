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

export const clampKm = (km: number) => Math.min(MAX_KM, Math.max(MIN_KM, Math.round(km * 10) / 10));

/** − goes to the whole kilometre below, + to the one above (7.3 → 7 or 8). */
export function stepKm(km: number, direction: 1 | -1): number {
  const next = direction > 0 ? Math.floor(km + 1e-9) + 1 : Math.ceil(km - 1e-9) - 1;
  return clampKm(next);
}

/** "8", "8.5", "21.1": no trailing zeros. */
export const formatKm = (km: number) => String(Math.round(km * 10) / 10);
