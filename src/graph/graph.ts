import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";
import type { OsmData } from "./overpass";

/**
 * An undirected street graph in compressed-sparse-row form, with every node and long
 * segment tagged with the H3 hexagons it passes through.
 */
export interface RoadGraph {
  n: number;
  lat: Float64Array;
  lng: Float64Array;
  resolution: number;
  /** Node -> index into `cellIds`. */
  cellOf: Int32Array;
  /**
   * 1 if the node is at least `margin` metres inside its hexagon. GPS wanders, so a route
   * only counts a hexagon (and only aims at a point in it) where it gets this far in.
   */
  safe: Uint8Array;
  cellIds: string[];
  cellIndex: Map<string, number>;
  /** CSR adjacency: slots offsets[u]..offsets[u+1] hold u's neighbours. */
  offsets: Int32Array;
  to: Int32Array;
  /** Metres. */
  w: Float32Array;
  /** Slot -> undirected segment id. */
  edgeOf: Int32Array;
  /** Segment id -> hexagons crossed mid-segment that neither end node is in. */
  extraCells: Map<number, number[]>;
  component: Int32Array;
  componentSize: Int32Array;
}

const R = 6_371_008.8;
const toRad = Math.PI / 180;

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * toRad;
  const dLng = (lng2 - lng1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Shortest distance from (px, py) to the edges of a closed polygon. */
export function distanceToEdge(xs: number[], ys: number[], px: number, py: number): number {
  let best = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const j = (i + 1) % xs.length;
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - xs[i]) * dx + (py - ys[i]) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(px - (xs[i] + t * dx), py - (ys[i] + t * dy)));
  }
  return best;
}

/** Segments longer than this are sampled so a hexagon crossed mid-segment still counts. */
const SAMPLE_EVERY = 30;

/** Default GPS safety margin, metres. */
export const MARGIN = 15;

/**
 * Longest street piece, metres. Map data only has points at junctions and bends, and a route
 * can only turn back at a point, so long straight streets are cut up: that way a quick trip into
 * a hexagon turns back just inside it instead of running on to the next junction.
 */
export const MAX_PIECE = 20;

export function buildGraph(osm: OsmData, resolution: number, margin = MARGIN, maxPiece = MAX_PIECE): RoadGraph {
  // Keep only nodes used by a way, and renumber them (in way order, so ids stay predictable).
  const used = new Int32Array(osm.lat.length).fill(-1);
  let n = 0;
  for (const way of osm.ways) for (const v of way) if (used[v] === -1) used[v] = n++;
  const latA: number[] = new Array(n);
  const lngA: number[] = new Array(n);
  for (let v = 0; v < used.length; v++) {
    if (used[v] >= 0) {
      latA[used[v]] = osm.lat[v];
      lngA[used[v]] = osm.lng[v];
    }
  }

  // Segments, with long ones cut into pieces; the new in-between nodes go after the originals.
  const us: number[] = [];
  const vs: number[] = [];
  for (const way of osm.ways) {
    for (let i = 0; i + 1 < way.length; i++) {
      const a = used[way[i]];
      const b = used[way[i + 1]];
      if (a === b) continue;
      const pieces = Math.max(1, Math.ceil(haversine(latA[a], lngA[a], latA[b], lngA[b]) / maxPiece));
      let prev = a;
      for (let k = 1; k < pieces; k++) {
        const f = k / pieces;
        const v = latA.length;
        latA.push(latA[a] + (latA[b] - latA[a]) * f);
        lngA.push(lngA[a] + (lngA[b] - lngA[a]) * f);
        us.push(prev);
        vs.push(v);
        prev = v;
      }
      us.push(prev);
      vs.push(b);
    }
  }
  n = latA.length;
  const lat = Float64Array.from(latA);
  const lng = Float64Array.from(lngA);
  const m = us.length;

  const cellIds: string[] = [];
  const cellIndex = new Map<string, number>();
  const cellId = (c: string) => {
    let i = cellIndex.get(c);
    if (i === undefined) {
      i = cellIds.length;
      cellIds.push(c);
      cellIndex.set(c, i);
    }
    return i;
  };
  // A point is safely inside if it is at least `margin` metres from every edge of its hexagon.
  // Edges are measured on a local flat projection around the hexagon, which is accurate to
  // centimetres at this size.
  const cellGeo: { lat: number; lng: number; kx: number; xs: number[]; ys: number[] }[] = [];
  const isSafe = (c: number, la: number, ln: number) => {
    let geo = cellGeo[c];
    if (!geo) {
      const [clat, clng] = cellToLatLng(cellIds[c]);
      const kx = R * toRad * Math.cos(clat * toRad);
      const ring = cellToBoundary(cellIds[c]);
      geo = cellGeo[c] = { lat: clat, lng: clng, kx, xs: ring.map(([, lng]) => (lng - clng) * kx), ys: ring.map(([lat]) => (lat - clat) * R * toRad) };
    }
    return distanceToEdge(geo.xs, geo.ys, (ln - geo.lng) * geo.kx, (la - geo.lat) * R * toRad) >= margin;
  };
  const cellOf = new Int32Array(n);
  const safe = new Uint8Array(n);
  for (let v = 0; v < n; v++) {
    cellOf[v] = cellId(latLngToCell(lat[v], lng[v], resolution));
    safe[v] = isSafe(cellOf[v], lat[v], lng[v]) ? 1 : 0;
  }

  const degree = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) {
    degree[us[e]]++;
    degree[vs[e]]++;
  }
  const offsets = new Int32Array(n + 1);
  for (let v = 0; v < n; v++) offsets[v + 1] = offsets[v] + degree[v];
  const fill = offsets.slice(0, n);
  const to = new Int32Array(2 * m);
  const w = new Float32Array(2 * m);
  const edgeOf = new Int32Array(2 * m);
  const extraCells = new Map<number, number[]>();

  for (let e = 0; e < m; e++) {
    const a = us[e];
    const b = vs[e];
    const len = haversine(lat[a], lng[a], lat[b], lng[b]);
    let s = fill[a]++;
    to[s] = b;
    w[s] = len;
    edgeOf[s] = e;
    s = fill[b]++;
    to[s] = a;
    w[s] = len;
    edgeOf[s] = e;

    if (len > SAMPLE_EVERY) {
      const steps = Math.ceil(len / SAMPLE_EVERY);
      let extra: number[] | undefined;
      for (let k = 1; k < steps; k++) {
        const f = k / steps;
        const la = lat[a] + (lat[b] - lat[a]) * f;
        const ln = lng[a] + (lng[b] - lng[a]) * f;
        const c = cellId(latLngToCell(la, ln, resolution));
        const counted = (c === cellOf[a] && safe[a]) || (c === cellOf[b] && safe[b]);
        if (!counted && !(extra && extra.includes(c)) && isSafe(c, la, ln)) (extra ??= []).push(c);
      }
      if (extra) extraCells.set(e, extra);
    }
  }

  // Connected components, so we never route to an island the start can't reach.
  const component = new Int32Array(n).fill(-1);
  const sizes: number[] = [];
  const queue = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (component[s] !== -1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    component[s] = id;
    while (head < tail) {
      const u = queue[head++];
      for (let k = offsets[u]; k < offsets[u + 1]; k++) {
        const v = to[k];
        if (component[v] === -1) {
          component[v] = id;
          queue[tail++] = v;
        }
      }
    }
    sizes.push(tail);
  }

  return {
    n, lat, lng, resolution, cellOf, safe, cellIds, cellIndex, offsets, to, w, edgeOf, extraCells,
    component, componentSize: Int32Array.from(sizes),
  };
}

/**
 * The closest node to a point, ignoring tiny disconnected fragments
 * (a footpath stub that touches nothing else would strand the route).
 */
export function nearestNode(g: RoadGraph, lat: number, lng: number): number {
  const minSize = Math.min(200, Math.max(...g.componentSize) * 0.05);
  const cos = Math.cos(lat * toRad);
  let best = -1;
  let bestD = Infinity;
  for (let v = 0; v < g.n; v++) {
    if (g.componentSize[g.component[v]] < minSize) continue;
    const dy = g.lat[v] - lat;
    const dx = (g.lng[v] - lng) * cos;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  if (best === -1) throw new Error("No streets found near the start point.");
  return best;
}

/** Nodes grouped by the hexagon they sit in, limited to one connected component. */
export function nodesByCell(g: RoadGraph, component: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let v = 0; v < g.n; v++) {
    if (g.component[v] !== component) continue;
    const c = g.cellOf[v];
    const list = out.get(c);
    if (list) list.push(v);
    else out.set(c, [v]);
  }
  return out;
}

/** The nodes far enough inside their hexagon to count, or all of them if none are. */
export function safeNodes(g: RoadGraph, nodes: number[]): number[] {
  const inner = nodes.filter((v) => g.safe[v]);
  return inner.length ? inner : nodes;
}

/** The node in `nodes` closest to the centre of hexagon `cell`. */
export function centreNode(g: RoadGraph, cell: number, nodes: number[]): number {
  const [clat, clng] = cellToLatLng(g.cellIds[cell]);
  const cos = Math.cos(clat * toRad);
  let best = nodes[0];
  let bestD = Infinity;
  for (const v of nodes) {
    const dy = g.lat[v] - clat;
    const dx = (g.lng[v] - clng) * cos;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = v;
    }
  }
  return best;
}
