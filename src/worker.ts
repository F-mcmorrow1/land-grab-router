/// <reference lib="webworker" />
import { buildGraph, nearestNode, type RoadGraph } from "./graph/graph";
import { fetchOsm, type BBox, type Profile } from "./graph/overpass";
import { fetchStreetTiles } from "./graph/tiles";
import type { RouteResult } from "./solve/common";
import { maxScore } from "./solve/maxScore";
import { visitAll } from "./solve/visitAll";

export type WorkerRequest =
  | { id: number; type: "load"; bbox: BBox; profile: Profile; resolution: number }
  | { id: number; type: "visitAll"; start: LatLng; targets: string[]; closed: boolean }
  | {
      id: number;
      type: "maxScore";
      start: LatLng;
      budget: number;
      closed: boolean;
      /** Points for hexagons already in play; anything else is worth `unclaimed`. */
      known: [string, number][];
      unclaimed: number;
    };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteMessage {
  coords: [number, number][];
  length: number;
  cells: string[];
  targets: string[];
  unreachable: string[];
}

export type WorkerResponse =
  | { id: number; type: "progress"; message: string; fraction?: number }
  | { id: number; type: "loaded"; nodes: number; segments: number; bbox: BBox }
  | { id: number; type: "route"; route: RouteMessage }
  | { id: number; type: "error"; message: string };

let graph: RoadGraph | null = null;

const post = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

function toMessage(g: RoadGraph, r: RouteResult): RouteMessage {
  return {
    coords: r.path.nodes.map((v) => [g.lng[v], g.lat[v]]),
    length: r.path.length,
    cells: [...r.cells].map((c) => g.cellIds[c]),
    targets: r.targets.map((c) => g.cellIds[c]),
    unreachable: r.unreachable,
  };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  const progress = (message: string, fraction?: number) => post({ id: req.id, type: "progress", message, fraction });
  try {
    if (req.type === "load") {
      let osm;
      let bbox = req.bbox;
      try {
        const tiles = await fetchStreetTiles(req.bbox, req.profile, progress);
        osm = tiles.osm;
        bbox = tiles.bbox;
      } catch (e) {
        progress(`Map tiles failed (${e instanceof Error ? e.message : e}); asking OpenStreetMap directly, which can take a minute or two`);
        osm = await fetchOsm(req.bbox, req.profile);
      }
      progress(`Building the street graph (${osm.lat.length.toLocaleString()} points)`);
      graph = buildGraph(osm, req.resolution);
      post({ id: req.id, type: "loaded", nodes: graph.n, segments: graph.to.length / 2, bbox });
      return;
    }
    if (!graph || graph.n === 0) throw new Error("No street map loaded for this area.");
    const g = graph;
    const start = nearestNode(g, req.start.lat, req.start.lng);
    if (req.type === "visitAll") {
      const r = visitAll({ g, start, targets: req.targets, closed: req.closed, onProgress: progress });
      post({ id: req.id, type: "route", route: toMessage(g, r) });
    } else {
      const known = new Map(req.known);
      const values = new Float64Array(g.cellIds.length);
      g.cellIds.forEach((c, i) => (values[i] = known.get(c) ?? req.unclaimed));
      const r = maxScore({ g, start, budget: req.budget, closed: req.closed, value: (c) => values[c], onProgress: progress });
      post({ id: req.id, type: "route", route: toMessage(g, r) });
    }
  } catch (e) {
    post({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
