import type { RoadGraph } from "./graph";

/** Binary min-heap of (key, node) pairs on typed arrays; stale entries are skipped on pop. */
class Heap {
  keys = new Float64Array(1024);
  vals = new Int32Array(1024);
  size = 0;

  push(key: number, val: number) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2);
      k.set(this.keys);
      this.keys = k;
      const v = new Int32Array(this.size * 2);
      v.set(this.vals);
      this.vals = v;
    }
    let i = this.size++;
    const { keys, vals } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const { keys, vals } = this;
    const top = vals[0];
    const n = --this.size;
    if (n > 0) {
      const key = keys[n];
      const val = vals[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

export interface ShortestPaths {
  dist: Float64Array;
  /** Previous node on the shortest path, or -1. */
  prevNode: Int32Array;
  /** Adjacency slot used to arrive at each node, or -1. */
  prevSlot: Int32Array;
}

export interface DijkstraOptions {
  /** Stop once this node is settled. */
  target?: number;
  /** Stop once these nodes are all settled. */
  targets?: Iterable<number>;
  /** Don't explore beyond this distance (metres). */
  maxDist?: number;
}

/** Shortest paths from `source`, or from the nearest of several sources. */
export function dijkstra(g: RoadGraph, source: number | number[], opts: DijkstraOptions = {}): ShortestPaths {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prevNode = new Int32Array(g.n).fill(-1);
  const prevSlot = new Int32Array(g.n).fill(-1);
  const done = new Uint8Array(g.n);
  const maxDist = opts.maxDist ?? Infinity;
  let pending = -1;
  let wanted: Uint8Array | undefined;
  if (opts.targets) {
    wanted = new Uint8Array(g.n);
    pending = 0;
    for (const t of opts.targets) {
      if (!wanted[t]) {
        wanted[t] = 1;
        pending++;
      }
    }
  }

  const heap = new Heap();
  for (const s of typeof source === "number" ? [source] : source) {
    dist[s] = 0;
    heap.push(0, s);
  }
  const { offsets, to, w } = g;
  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === opts.target) break;
    if (wanted && wanted[u] && --pending === 0) break;
    const du = dist[u];
    for (let k = offsets[u]; k < offsets[u + 1]; k++) {
      const v = to[k];
      const nd = du + w[k];
      if (nd < dist[v] && nd <= maxDist) {
        dist[v] = nd;
        prevNode[v] = u;
        prevSlot[v] = k;
        heap.push(nd, v);
      }
    }
  }
  return { dist, prevNode, prevSlot };
}

export interface Path {
  nodes: number[];
  /** slots[i] is the adjacency slot from nodes[i] to nodes[i + 1]. */
  slots: number[];
  length: number;
}

export function extractPath(sp: ShortestPaths, target: number): Path {
  if (!Number.isFinite(sp.dist[target])) throw new Error("No route to that point.");
  const nodes: number[] = [];
  const slots: number[] = [];
  for (let v = target; v !== -1; v = sp.prevNode[v]) {
    nodes.push(v);
    if (sp.prevSlot[v] !== -1) slots.push(sp.prevSlot[v]);
  }
  nodes.reverse();
  slots.reverse();
  return { nodes, slots, length: sp.dist[target] };
}

export function joinPaths(paths: Path[]): Path {
  const out: Path = { nodes: [], slots: [], length: 0 };
  for (const p of paths) {
    if (p.nodes.length === 0) continue;
    const skipFirst = out.nodes.length > 0 && out.nodes[out.nodes.length - 1] === p.nodes[0];
    out.nodes.push(...(skipFirst ? p.nodes.slice(1) : p.nodes));
    out.slots.push(...p.slots);
    out.length += p.length;
  }
  return out;
}

/** Every hexagon a path gets far enough into to count (see RoadGraph.safe). */
export function pathCells(g: RoadGraph, p: Path, into = new Set<number>()): Set<number> {
  for (const v of p.nodes) if (g.safe[v]) into.add(g.cellOf[v]);
  for (const s of p.slots) {
    const extra = g.extraCells.get(g.edgeOf[s]);
    if (extra) for (const c of extra) into.add(c);
  }
  return into;
}
