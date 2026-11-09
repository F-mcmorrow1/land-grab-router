import { dijkstra, type Path } from "../graph/dijkstra";
import type { RoadGraph } from "../graph/graph";
import type { Matrix } from "./tour";

export type Progress = (message: string, fraction?: number) => void;

export interface RouteResult {
  path: Path;
  /** Every hexagon (index into g.cellIds) the route passes through. */
  cells: Set<number>;
  /** Hexagons the route was aimed at, in visiting order. */
  targets: number[];
  /** Requested hexagons with no reachable street inside them. */
  unreachable: string[];
}

/** Road distances between every pair of `nodes`. Unreachable pairs are Infinity. */
export function distanceMatrix(g: RoadGraph, nodes: number[], onProgress?: Progress, maxDist?: number): Matrix {
  const k = nodes.length;
  const d = new Float64Array(k * k).fill(Infinity);
  for (let i = 0; i < k; i++) {
    if (i % 5 === 0) onProgress?.(`Measuring distances between hexagons (${i}/${k})`, i / k);
    const sp = dijkstra(g, nodes[i], { targets: nodes, maxDist });
    for (let j = 0; j < k; j++) d[i * k + j] = sp.dist[nodes[j]];
  }
  // The graph is undirected, so make the matrix exactly symmetric (early exits can leave gaps).
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const v = Math.min(d[i * k + j], d[j * k + i]);
      d[i * k + j] = v;
      d[j * k + i] = v;
    }
  }
  return { k, d };
}
