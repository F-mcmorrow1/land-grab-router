import { cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import type { RawActivity, RawLandGrab } from "./types";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Makes a believable land-grab week around a point, in the same JSON shape as the API,
 * so the whole app can be tried without real data.
 */
export function makeDemo(center: { lat: number; lng: number }, seed = 7, resolution = 8): RawLandGrab {
  const rand = mulberry32(seed);
  // Our team is first; the rivals are made up.
  const teams = [
    { id: 29, name: "Worst Pace Scenario", colour: "#f4f4ed" },
    { id: 901, name: "Lime Lungs", colour: null },
    { id: 902, name: "Steel Blues", colour: null },
    { id: 903, name: "Copper Tops", colour: null },
  ];
  const regionOffsets = [
    [0, 0],
    [0.045, -0.07],
    [-0.04, 0.08],
  ];
  const regions = regionOffsets.map(([dLat, dLng], i) => {
    const lat = center.lat + dLat;
    const lng = center.lng + dLng;
    return { name: ["Home patch", "North west", "South east"][i], lat, lng, bounds: [lng - 0.05, lat - 0.03, lng + 0.05, lat + 0.03] as [number, number, number, number] };
  });

  const cells: string[] = [];
  const cellIndex = new Map<string, number>();
  const idx = (c: string) => {
    let i = cellIndex.get(c);
    if (i === undefined) {
      i = cells.length;
      cells.push(c);
      cellIndex.set(c, i);
    }
    return i;
  };

  const today = 3; // Thursday
  const activities: RawActivity[] = [];
  const count = 90;
  for (let a = 0; a < count; a++) {
    // Weight teams so standings aren't level.
    const r = rand();
    const team = r < 0.32 ? 1 : r < 0.6 ? 0 : r < 0.82 ? 2 : 3;
    const region = rand() < 0.65 ? 0 : rand() < 0.5 ? 1 : 2;
    const reg = regions[region];
    let lat = reg.lat + (rand() - 0.5) * 0.05;
    let lng = reg.lng + (rand() - 0.5) * 0.08;
    let heading = rand() * Math.PI * 2;
    let cell = latLngToCell(lat, lng, resolution);
    const path: number[] = [idx(cell)];
    const seen = new Set([cell]);
    const len = 6 + Math.floor(rand() * 18);
    for (let s = 0; s < len; s++) {
      heading += (rand() - 0.5) * 1.2;
      const [clat, clng] = cellToLatLng(cell);
      const options = gridDisk(cell, 1).filter((c) => c !== cell);
      let best = options[0];
      let bestScore = -Infinity;
      for (const o of options) {
        const [olat, olng] = cellToLatLng(o);
        const ang = Math.atan2(olat - clat, (olng - clng) * Math.cos((clat * Math.PI) / 180));
        const score = Math.cos(ang - heading) + rand() * 0.3 - (seen.has(o) ? 0.8 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = o;
        }
      }
      cell = best;
      if (!seen.has(cell)) {
        seen.add(cell);
        path.push(idx(cell));
      }
      [lat, lng] = cellToLatLng(cell);
    }
    const minutes = Math.floor(rand() * (today * 1440 + 1080));
    activities.push({
      athlete: ["Sam", "Alex", "Jo", "Kit", "Robin", "Ash", "Max", "Sky", "Lee", "Noor"][Math.floor(rand() * 10)],
      team,
      region,
      minutes,
      cells: path,
      offsets: path.map((_, i) => i * 3),
      mine: team === 0 && rand() < 0.2,
    });
  }
  activities.sort((x, y) => x.minutes - y.minutes);
  return { teams, cells, activities, regions, your_team: 0, your_region: 0, today };
}
