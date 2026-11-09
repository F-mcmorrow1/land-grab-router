import { cellToBoundary, latLngToCell } from "h3-js";
import { LngLatBounds, Map as MLMap, Marker, NavigationControl, type ExpressionSpecification, type GeoJSONSource } from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker next to its own script, which bundlers move; point it at the file directly.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(maplibreWorkerUrl);
import type { Feature, FeatureCollection } from "geojson";
import type { Outcome } from "./scoring";

export const BASEMAP = "https://tiles.openfreemap.org/styles/dark";
export const BG = "#111112";
export const INK = "#f4f4ed";
export const ROUTE = "#38f2ff";

export const OUTCOME_COLOURS: Record<Outcome, string> = {
  claim: "#d2ff00",
  steal: "#ff5c8a",
  defend: "#ffb020",
  siege: "#a79bc4",
  secure: "#3d4036",
};

export interface HexProps {
  cell: string;
  team: number;
  /** Opacity in the Teams view (firmness of hold). */
  opacity: number;
  outcome: Outcome;
  /** 0..1, opacity in the Opportunities view. */
  strength: number;
}

type FC = FeatureCollection;
type PaintProp = Parameters<MLMap["setPaintProperty"]>[1];
const empty = (): FC => ({ type: "FeatureCollection", features: [] });
const ring = (cell: string) => cellToBoundary(cell, true);

export const hexPolygon = (cell: string, properties: object = {}): Feature => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [ring(cell)] },
  properties: { cell, ...properties },
});
const hexOutline = (cell: string): Feature => ({
  type: "Feature",
  geometry: { type: "LineString", coordinates: ring(cell) },
  properties: { cell },
});

/** The same darkening strods.uk applies on top of OpenFreeMap's dark style. */
function darken(map: MLMap) {
  const paints: [string, PaintProp, string][] = [
    ["background", "background-color", BG],
    ["water", "fill-color", "#1c1e21"],
    ["waterway", "line-color", "#1c1e21"],
    ["landuse_residential", "fill-color", "#141415"],
    ["landcover_wood", "fill-color", "#191b17"],
    ["landuse_park", "fill-color", "#191b17"],
    ["building", "fill-color", "#151516"],
    ["highway_minor", "line-color", "#232422"],
    ["highway_major_inner", "line-color", "#2b2c29"],
    ["highway_motorway_inner", "line-color", "#33342f"],
  ];
  for (const [layer, prop, colour] of paints) if (map.getLayer(layer)) map.setPaintProperty(layer, prop, colour);
  for (const layer of map.getStyle().layers ?? []) {
    if (layer.id.startsWith("place_")) map.setPaintProperty(layer.id, "text-color" as PaintProp, "#8d8f82");
  }
}

export class PlannerMap {
  readonly map: MLMap;
  readonly ready: Promise<void>;
  private startMarker: Marker;
  private resolution = 8;
  private teamColours: string[] = [];
  private view: "teams" | "plan" = "teams";
  private loaded = false;
  /** Latest data for each overlay, kept so it can be applied whenever the style is ready. */
  private data: Record<string, FC> = { hexes: empty(), covered: empty(), selected: empty(), hover: empty(), route: empty() };

  constructor(container: HTMLElement, center: [number, number]) {
    this.map = new MLMap({
      container,
      style: BASEMAP,
      center,
      zoom: 12,
      maxZoom: 17,
      dragRotate: false,
      pitchWithRotate: false,
      attributionControl: { compact: true },
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // The basemap asks for a few patterns its sprite doesn't ship; stand in a transparent pixel.
    // (MapLibre still logs a warning for these; it's harmless.)
    this.map.on("styleimagemissing", (e) => {
      if (!this.map.hasImage(e.id)) this.map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    const el = document.createElement("div");
    el.className = "start-marker";
    el.title = "Start (drag to move)";
    el.textContent = "S";
    this.startMarker = new Marker({ element: el, draggable: true });

    // Overlays go on as soon as the style is parsed (not after the first full render, which
    // never comes in a background tab), and anything set before then is applied here.
    this.ready = new Promise((resolve) => {
      this.map.once("style.load", () => {
        darken(this.map);
        const below = this.map.getLayer("highway_name_other") ? "highway_name_other" : undefined;
        for (const [id, fc] of Object.entries(this.data)) this.map.addSource(id, { type: "geojson", data: fc });
        this.map.addLayer({ id: "hex-fill", type: "fill", source: "hexes", paint: { "fill-color": INK, "fill-opacity": ["get", "opacity"] } }, below);
        this.map.addLayer(
          {
            id: "hex-gap",
            type: "line",
            source: "hexes",
            paint: { "line-color": BG, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 13, 2.5] },
          },
          below,
        );
        this.map.addLayer({ id: "covered", type: "line", source: "covered", paint: { "line-color": ROUTE, "line-width": 1.2, "line-opacity": 0.8 } });
        this.map.addLayer({
          id: "selected",
          type: "line",
          source: "selected",
          paint: { "line-color": INK, "line-width": 2.5, "line-dasharray": [2, 1.2] },
        });
        this.map.addLayer({ id: "hover", type: "line", source: "hover", paint: { "line-color": INK, "line-width": 2 } });
        this.map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": "#000", "line-width": 7, "line-opacity": 0.7 },
        });
        this.map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ROUTE, "line-width": 3.5 },
        });
        this.loaded = true;
        this.applyView();
        resolve();
      });
    });
  }

  private put(id: string, fc: FC) {
    this.data[id] = fc;
    if (this.loaded) (this.map.getSource(id) as GeoJSONSource).setData(fc);
  }

  setResolution(res: number) {
    this.resolution = res;
  }

  cellAt(lat: number, lng: number) {
    return latLngToCell(lat, lng, this.resolution);
  }

  setTeamColours(colours: string[]) {
    this.teamColours = colours;
    this.applyView();
  }

  setView(view: "teams" | "plan") {
    this.view = view;
    this.applyView();
  }

  private applyView() {
    if (!this.loaded) return;
    if (this.view === "teams") {
      const colour: ExpressionSpecification | string = this.teamColours.length
        ? (["match", ["get", "team"], ...this.teamColours.flatMap((c, i) => [i, c]), INK] as unknown as ExpressionSpecification)
        : INK;
      this.map.setPaintProperty("hex-fill", "fill-color", colour);
      this.map.setPaintProperty("hex-fill", "fill-opacity", ["get", "opacity"]);
    } else {
      const colour = ["match", ["get", "outcome"], ...Object.entries(OUTCOME_COLOURS).flat(), INK] as unknown as ExpressionSpecification;
      this.map.setPaintProperty("hex-fill", "fill-color", colour);
      this.map.setPaintProperty("hex-fill", "fill-opacity", ["*", 0.85, ["get", "strength"]]);
    }
  }

  setHexes(hexes: HexProps[]) {
    this.put("hexes", { type: "FeatureCollection", features: hexes.map((h) => hexPolygon(h.cell, h)) });
  }

  setSelected(cells: Iterable<string>) {
    this.put("selected", { type: "FeatureCollection", features: [...cells].map(hexOutline) });
  }

  setHover(cell: string | null) {
    this.put("hover", { type: "FeatureCollection", features: cell ? [hexOutline(cell)] : [] });
  }

  setRoute(coords: [number, number][] | null, cells: string[] = []) {
    this.put(
      "route",
      coords && coords.length > 1
        ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] }
        : empty(),
    );
    this.put("covered", { type: "FeatureCollection", features: cells.map(hexOutline) });
  }

  setStart(lat: number, lng: number) {
    this.startMarker.setLngLat([lng, lat]).addTo(this.map);
  }

  onStartDragged(cb: (lat: number, lng: number) => void) {
    this.startMarker.on("dragend", () => {
      const p = this.startMarker.getLngLat();
      cb(p.lat, p.lng);
    });
  }

  fitCoords(coords: [number, number][], maxZoom = 14) {
    if (!coords.length) return;
    const b = new LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
    this.map.fitBounds(b, { padding: 60, maxZoom, duration: 1200 });
  }

  fitBounds(bounds: [number, number, number, number]) {
    this.map.fitBounds(bounds, { padding: 40, maxZoom: 13.5, duration: 1200 });
  }
}
