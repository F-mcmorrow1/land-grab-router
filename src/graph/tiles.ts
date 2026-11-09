import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import type { BBox, OsmData, Profile } from "./overpass";

/**
 * Street network from OpenFreeMap's vector tiles: the same tiles the basemap draws.
 *
 * The tiles' `transportation` layer holds every road and path at zoom 14, served from a CDN,
 * so this is far quicker and more reliable than the public Overpass servers. The catch is
 * that tiles are lightly simplified and cut at tile edges, so a few junctions lose their
 * shared point. `repairJunctions` puts them back.
 */

const TILEJSON = "https://tiles.openfreemap.org/planet";
export const Z = 14;
const MAX_TILES = 140;

const ROUTABLE = new Set(["trunk", "primary", "secondary", "tertiary", "minor", "service", "track", "path"]);
const BIKE_ONLY_IF_ALLOWED = new Set(["footway", "pedestrian", "steps", "bridleway"]);
const BIKE_ALLOWED = new Set(["yes", "designated", "permissive"]);

type Props = Record<string, string | number | boolean | undefined>;

export function routable(p: Props, profile: Profile): boolean {
  if (!ROUTABLE.has(String(p.class))) return false;
  if (p.access === "no" || p.access === "private") return false;
  if (p.indoor) return false;
  const sub = String(p.subclass ?? "");
  if (p.class === "path" && (sub === "platform" || sub === "corridor")) return false;
  if (profile === "foot") return p.foot !== "no" && p.foot !== "private";
  if (p.bicycle === "no" || p.bicycle === "dismount") return false;
  if (p.class === "path" && BIKE_ONLY_IF_ALLOWED.has(sub)) return BIKE_ALLOWED.has(String(p.bicycle));
  return true;
}

const lng2x = (lng: number) => ((lng + 180) / 360) * 2 ** Z;
const lat2y = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z;
};

export function tileRange([w, s, e, n]: BBox) {
  return { x0: Math.floor(lng2x(w)), x1: Math.floor(lng2x(e)), y0: Math.floor(lat2y(n)), y1: Math.floor(lat2y(s)) };
}

/** The exact area covered by the tiles touching `bbox`. */
export function tileBBox(bbox: BBox): BBox {
  const { x0, x1, y0, y1 } = tileRange(bbox);
  const x2lng = (x: number) => (x / 2 ** Z) * 360 - 180;
  const y2lat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** Z))) * 180) / Math.PI;
  return [x2lng(x0), y2lat(y1 + 1), x2lng(x1 + 1), y2lat(y0)];
}

let template: Promise<string> | null = null;
function tileTemplate(): Promise<string> {
  template ??= fetch(TILEJSON)
    .then((r) => {
      if (!r.ok) throw new Error(`OpenFreeMap ${r.status}`);
      return r.json();
    })
    .then((j: { tiles: string[] }) => j.tiles[0])
    .catch((e) => {
      template = null;
      throw e;
    });
  return template;
}

async function fetchTile(url: string, signal?: AbortSignal): Promise<Uint8Array | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: signal ?? AbortSignal.timeout(20_000) });
      if (res.status === 204 || res.status === 404) return null; // empty sea / missing tile
      if (!res.ok) throw new Error(`tile ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      if (attempt === 1) throw e;
    }
  }
  return null;
}

/** A street segment in "world units": zoom-14 tile coordinates times the tile extent. */
export interface RawSegments {
  xs: number[];
  ys: number[];
  /** Node index pairs. */
  segs: [number, number][];
  /** Per segment: the layer it's on, or null for bridges / tunnels (they never join what they cross). */
  grade: (number | null)[];
  /** World units per tile, and the world-unit origin of xs/ys. */
  extent: number;
  originX: number;
  originY: number;
}

export async function fetchStreetTiles(
  bbox: BBox,
  profile: Profile,
  onProgress?: (message: string) => void,
): Promise<{ osm: OsmData; bbox: BBox; tiles: number }> {
  const { x0, x1, y0, y1 } = tileRange(bbox);
  const jobs: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) jobs.push([x, y]);
  if (jobs.length > MAX_TILES) throw new Error(`That area needs ${jobs.length} map tiles; keep it under ${MAX_TILES}.`);
  const url = await tileTemplate();

  const extent = 4096;
  const raw: RawSegments = { xs: [], ys: [], segs: [], grade: [], extent, originX: x0 * extent, originY: y0 * extent };
  const keyOf = new Map<number, number>();
  const node = (x: number, y: number) => {
    // Half-unit grid relative to the origin keeps keys well inside 2^53.
    const key = Math.round((x - raw.originX) * 2) * 2 ** 22 + Math.round((y - raw.originY) * 2);
    let i = keyOf.get(key);
    if (i === undefined) {
      i = raw.xs.length;
      raw.xs.push(x - raw.originX);
      raw.ys.push(y - raw.originY);
      keyOf.set(key, i);
    }
    return i;
  };

  let done = 0;
  const work = async (tx: number, ty: number) => {
    const buf = await fetchTile(url.replace("{z}", String(Z)).replace("{x}", String(tx)).replace("{y}", String(ty)));
    done++;
    onProgress?.(`Downloading street tiles (${done}/${jobs.length})`);
    if (!buf) return;
    const layer = new VectorTile(new PbfReader(buf)).layers.transportation;
    if (!layer) return;
    const scale = extent / layer.extent;
    const bx0 = tx * extent;
    const by0 = ty * extent;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i);
      if (f.type !== 2) continue; // lines only; skip pedestrian-area polygons
      const props = f.properties as Props;
      if (!routable(props, profile)) continue;
      const g = props.brunnel === "bridge" || props.brunnel === "tunnel" ? null : Number(props.layer ?? 0);
      for (const line of f.loadGeometry()) {
        for (let k = 0; k + 1 < line.length; k++) {
          const ax = bx0 + line[k].x * scale;
          const ay = by0 + line[k].y * scale;
          const bx = bx0 + line[k + 1].x * scale;
          const by = by0 + line[k + 1].y * scale;
          // Keep only the part inside this tile; the neighbour owns the rest (tiles overlap by a buffer).
          const clipped = clip(ax, ay, bx, by, bx0, by0, bx0 + extent, by0 + extent);
          if (!clipped) continue;
          const a = node(clipped[0], clipped[1]);
          const b = node(clipped[2], clipped[3]);
          if (a !== b) {
            raw.segs.push([a, b]);
            raw.grade.push(g);
          }
        }
      }
    }
  };

  // A few at a time, like a browser would.
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(8, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await work(job[0], job[1]);
    }),
  );

  onProgress?.("Joining up the street network");
  repairJunctions(raw);
  return { osm: toOsm(raw), bbox: tileBBox(bbox), tiles: jobs.length };
}

/** Liang–Barsky clip of segment A→B to a box. */
export function clip(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const edges: [number, number][] = [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  if (t1 - t0 < 1e-9) return null;
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** Bucketed index of segments for nearby lookups. */
function bucketIndex(raw: RawSegments, size: number, include: (s: number) => boolean) {
  const buckets = new Map<number, number[]>();
  raw.segs.forEach(([a, b], s) => {
    if (!include(s)) return;
    const minX = Math.floor(Math.min(raw.xs[a], raw.xs[b]) / size);
    const maxX = Math.floor(Math.max(raw.xs[a], raw.xs[b]) / size);
    const minY = Math.floor(Math.min(raw.ys[a], raw.ys[b]) / size);
    const maxY = Math.floor(Math.max(raw.ys[a], raw.ys[b]) / size);
    for (let x = minX; x <= maxX; x++)
      for (let y = minY; y <= maxY; y++) {
        const k = x * 65536 + y;
        const list = buckets.get(k);
        if (list) list.push(s);
        else buckets.set(k, [s]);
      }
  });
  return buckets;
}

/** Split segments at the given points (each split: segment, position 0..1 along it, node). */
function applySplits(raw: RawSegments, splits: Map<number, { t: number; node: number }[]>) {
  splits.forEach((points, s) => {
    const [a, b] = raw.segs[s];
    points.sort((p, q) => p.t - q.t);
    const chain = [a, ...points.map((p) => p.node), b].filter((v, i, arr) => i === 0 || v !== arr[i - 1]);
    raw.segs[s] = [chain[0], chain[1]];
    for (let i = 1; i + 1 < chain.length; i++) {
      raw.segs.push([chain[i], chain[i + 1]]);
      raw.grade.push(raw.grade[s]);
    }
  });
}

/**
 * 1. Streets that cross at the same level (not bridges or tunnels) but share no point
 *    get one at the crossing.
 * 2. Loose ends within `snap` world units (~1.5 m) of another street are joined to it.
 *    This fixes junctions on straight roads that simplification removed, and seams
 *    between tiles.
 */
export function repairJunctions(raw: RawSegments, snap = 4) {
  const addNode = (x: number, y: number) => {
    raw.xs.push(x);
    raw.ys.push(y);
    return raw.xs.length - 1;
  };

  // 1. Level crossings.
  {
    const buckets = bucketIndex(raw, 128, (s) => raw.grade[s] !== null);
    const seen = new Set<number>();
    const splits = new Map<number, { t: number; node: number }[]>();
    const n = raw.segs.length;
    buckets.forEach((list) => {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const s1 = Math.min(list[i], list[j]);
          const s2 = Math.max(list[i], list[j]);
          if (raw.grade[s1] !== raw.grade[s2]) continue;
          const pairKey = s1 * n + s2;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);
          const [a, b] = raw.segs[s1];
          const [c, d] = raw.segs[s2];
          if (a === c || a === d || b === c || b === d) continue;
          const hit = intersect(raw.xs[a], raw.ys[a], raw.xs[b], raw.ys[b], raw.xs[c], raw.ys[c], raw.xs[d], raw.ys[d]);
          if (!hit) continue;
          const v = addNode(hit.x, hit.y);
          (splits.get(s1) ?? splits.set(s1, []).get(s1)!).push({ t: hit.t, node: v });
          (splits.get(s2) ?? splits.set(s2, []).get(s2)!).push({ t: hit.u, node: v });
        }
      }
    });
    applySplits(raw, splits);
  }

  // 2. Loose ends.
  {
    const degree = new Int32Array(raw.xs.length);
    for (const [a, b] of raw.segs) {
      degree[a]++;
      degree[b]++;
    }
    const size = 32;
    const buckets = bucketIndex(raw, size, () => true);
    const splits = new Map<number, { t: number; node: number }[]>();
    const extra: [number, number][] = [];
    for (let v = 0; v < raw.xs.length; v++) {
      if (degree[v] !== 1) continue;
      const x = raw.xs[v];
      const y = raw.ys[v];
      let best: { s: number; d: number; t: number } | null = null;
      for (let bx = Math.floor((x - snap) / size); bx <= Math.floor((x + snap) / size); bx++) {
        for (let by = Math.floor((y - snap) / size); by <= Math.floor((y + snap) / size); by++) {
          for (const s of buckets.get(bx * 65536 + by) ?? []) {
            const [a, b] = raw.segs[s];
            if (a === v || b === v) continue;
            const { d, t } = project(x, y, raw.xs[a], raw.ys[a], raw.xs[b], raw.ys[b]);
            if (d <= snap && (!best || d < best.d)) best = { s, d, t };
          }
        }
      }
      if (!best) continue;
      const [a, b] = raw.segs[best.s];
      const len = Math.hypot(raw.xs[b] - raw.xs[a], raw.ys[b] - raw.ys[a]);
      if (best.t * len < 1) extra.push([v, a]);
      else if ((1 - best.t) * len < 1) extra.push([v, b]);
      else {
        const p = addNode(raw.xs[a] + (raw.xs[b] - raw.xs[a]) * best.t, raw.ys[a] + (raw.ys[b] - raw.ys[a]) * best.t);
        (splits.get(best.s) ?? splits.set(best.s, []).get(best.s)!).push({ t: best.t, node: p });
        extra.push([v, p]);
      }
    }
    applySplits(raw, splits);
    for (const [a, b] of extra) {
      if (a !== b) {
        raw.segs.push([a, b]);
        raw.grade.push(0);
      }
    }
  }
}

function intersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const rX = bx - ax;
  const rY = by - ay;
  const sX = dx - cx;
  const sY = dy - cy;
  const den = rX * sY - rY * sX;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sY - (cy - ay) * sX) / den;
  const u = ((cx - ax) * rY - (cy - ay) * rX) / den;
  const eps = 1e-6;
  if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
  return { x: ax + t * rX, y: ay + t * rY, t, u };
}

function project(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return { d: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

export function toOsm(raw: RawSegments): OsmData {
  const world = raw.extent * 2 ** Z;
  const n = raw.xs.length;
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lng[i] = ((raw.originX + raw.xs[i]) / world) * 360 - 180;
    lat[i] = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (raw.originY + raw.ys[i])) / world))) * 180) / Math.PI;
  }
  return { lat, lng, ways: raw.segs.map(([a, b]) => Int32Array.of(a, b)) };
}
