/** Fetches walkable / rideable OpenStreetMap ways from the Overpass API. */

export type Profile = "foot" | "bike";
/** [west, south, east, north] */
export type BBox = [number, number, number, number];

export interface OsmData {
  lat: Float64Array;
  lng: Float64Array;
  /** Each way as a list of node indexes into lat/lng. */
  ways: Int32Array[];
}

/** Public Overpass servers, tried in turn. Each gets `timeout` ms before we move on. */
const ENDPOINTS = [
  { url: "https://overpass-api.de/api/interpreter", timeout: 45_000 },
  { url: "https://overpass.kumi.systems/api/interpreter", timeout: 120_000 },
  { url: "https://overpass.private.coffee/api/interpreter", timeout: 120_000 },
];

const ROADS = "residential|living_street|unclassified|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link|road|track";

/**
 * Pavements mapped as separate footways (most of London) roughly double the download but
 * add nothing a route along the road itself doesn't, so they're left out, as are
 * driveways and car-park aisles.
 */
export function overpassQuery([w, s, e, n]: BBox, profile: Profile): string {
  const box = `(${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)})`;
  const common = `["access"!~"^(private|no)$"]["area"!="yes"]`;
  const notPavement = `["footway"!~"^(sidewalk|crossing|access_aisle|traffic_island)$"]`;
  const service = `way["highway"="service"]["service"!~"^(parking_aisle|driveway|drive-through|emergency_access)$"]${common}`;
  const parts =
    profile === "foot"
      ? [
          `way["highway"~"^(${ROADS}|footway|path|pedestrian|steps|cycleway|bridleway)$"]${notPavement}["foot"!~"^(no|private)$"]${common}${box};`,
          `${service}["foot"!~"^(no|private)$"]${box};`,
        ]
      : [
          `way["highway"~"^(${ROADS}|cycleway|path)$"]["bicycle"!~"^(no|private|dismount)$"]${common}${box};`,
          `way["highway"~"^(footway|pedestrian|bridleway)$"]${notPavement}["bicycle"~"^(yes|designated|permissive)$"]${common}${box};`,
          `${service}["bicycle"!~"^(no|private)$"]${box};`,
        ];
  return `[out:json][timeout:110];(${parts.join("")});(._;>;);out skel qt;`;
}

interface OverpassJson {
  elements: ({ type: "node"; id: number; lat: number; lon: number } | { type: "way"; id: number; nodes: number[] })[];
}

export function parseOverpass(json: OverpassJson): OsmData {
  const ids = new Map<number, number>();
  const lat: number[] = [];
  const lng: number[] = [];
  for (const el of json.elements) {
    if (el.type === "node") {
      ids.set(el.id, lat.length);
      lat.push(el.lat);
      lng.push(el.lon);
    }
  }
  const ways: Int32Array[] = [];
  for (const el of json.elements) {
    if (el.type !== "way") continue;
    const nodes = el.nodes.map((id) => ids.get(id) ?? -1).filter((i) => i >= 0);
    if (nodes.length >= 2) ways.push(Int32Array.from(nodes));
  }
  return { lat: Float64Array.from(lat), lng: Float64Array.from(lng), ways };
}

export async function fetchOsm(bbox: BBox, profile: Profile, signal?: AbortSignal): Promise<OsmData> {
  const body = "data=" + encodeURIComponent(overpassQuery(bbox, profile));
  let lastError: unknown;
  for (const { url, timeout } of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
      });
      if (!res.ok) throw new Error(`Overpass ${res.status} ${res.statusText}`);
      return parseOverpass(await res.json());
    } catch (e) {
      if (signal?.aborted) throw e;
      lastError = e;
    }
  }
  throw new Error(`Couldn't download the street map from OpenStreetMap (${String(lastError)}). Try again in a minute.`);
}

/** A box around a point, `radius` metres in every direction. */
export function bboxAround(lat: number, lng: number, radius: number): BBox {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

export function bboxContains(outer: BBox, inner: BBox): boolean {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
