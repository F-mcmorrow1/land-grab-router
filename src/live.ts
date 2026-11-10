import { cellToBoundary } from "h3-js";
import { distanceToEdge } from "./graph/graph";

/** Geometry for the live location layer. Distances in metres, coordinates [lng, lat]. */

const R = 6_371_008.8;
const toRad = Math.PI / 180;

/** A flat local projection around a point: accurate to centimetres over a few kilometres. */
function local(lat0: number, lng0: number) {
  const kx = R * toRad * Math.cos(lat0 * toRad);
  const ky = R * toRad;
  return {
    to: (lat: number, lng: number): [number, number] => [(lng - lng0) * kx, (lat - lat0) * ky],
    from: (x: number, y: number): [number, number] => [lng0 + x / kx, lat0 + y / ky],
  };
}

/** How far (lat, lng) is from the nearest edge of hexagon `cell`. Assumes the point is in it. */
export function depthInCell(cell: string, lat: number, lng: number): number {
  const p = local(lat, lng);
  const ring = cellToBoundary(cell).map(([la, ln]) => p.to(la, ln));
  return distanceToEdge(
    ring.map((v) => v[0]),
    ring.map((v) => v[1]),
    0,
    0,
  );
}

/** Shortest distance from (lat, lng) to a route line. Infinity if the route is empty. */
export function distanceToRoute(coords: [number, number][], lat: number, lng: number): number {
  if (!coords.length) return Infinity;
  const p = local(lat, lng);
  let best = Infinity;
  let prev = p.to(coords[0][1], coords[0][0]);
  if (coords.length === 1) return Math.hypot(prev[0], prev[1]);
  for (let i = 1; i < coords.length; i++) {
    const cur = p.to(coords[i][1], coords[i][0]);
    const dx = cur[0] - prev[0];
    const dy = cur[1] - prev[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, (-prev[0] * dx - prev[1] * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(prev[0] + t * dx, prev[1] + t * dy));
    prev = cur;
  }
  return best;
}

/** A closed ring approximating a circle of `radius` metres. */
export function circleRing(lat: number, lng: number, radius: number, steps = 48): [number, number][] {
  const p = local(lat, lng);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push(p.from(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  return ring;
}

/** A wedge pointing along `heading` (degrees clockwise from north), for the direction you're moving. */
export function headingWedge(lat: number, lng: number, heading: number, length = 28, spread = 32): [number, number][] {
  const p = local(lat, lng);
  const point = (deg: number, r: number) => {
    const a = deg * toRad;
    return p.from(Math.sin(a) * r, Math.cos(a) * r);
  };
  return [p.from(0, 0), point(heading - spread, length * 0.7), point(heading, length), point(heading + spread, length * 0.7), p.from(0, 0)];
}
