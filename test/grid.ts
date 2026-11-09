import { buildGraph, nearestNode, type RoadGraph } from "../src/graph/graph";
import type { OsmData } from "../src/graph/overpass";

/** A square street grid: `size` x `size` junctions, `spacing` metres apart, plus a detached island. */
export function grid(size = 31, spacing = 120): { g: RoadGraph; centre: number } {
  const lat0 = 51.5;
  const lng0 = -0.12;
  const dLat = spacing / 111_320;
  const dLng = spacing / (111_320 * Math.cos((lat0 * Math.PI) / 180));
  const lat: number[] = [];
  const lng: number[] = [];
  const id = (r: number, c: number) => r * size + c;
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++) {
      lat.push(lat0 + (r - (size - 1) / 2) * dLat);
      lng.push(lng0 + (c - (size - 1) / 2) * dLng);
    }
  const ways: Int32Array[] = [];
  for (let r = 0; r < size; r++) ways.push(Int32Array.from({ length: size }, (_, c) => id(r, c)));
  for (let c = 0; c < size; c++) ways.push(Int32Array.from({ length: size }, (_, r) => id(r, c)));
  // A footpath island nobody can reach.
  const island = lat.length;
  lat.push(lat0 + 0.0005, lat0 + 0.0006);
  lng.push(lng0 + 0.0005, lng0 + 0.0006);
  ways.push(Int32Array.from([island, island + 1]));
  const osm: OsmData = { lat: Float64Array.from(lat), lng: Float64Array.from(lng), ways };
  const g = buildGraph(osm, 8);
  return { g, centre: nearestNode(g, lat0, lng0) };
}

