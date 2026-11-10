import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";
import {
  LngLatBounds,
  Map as MLMap,
  Marker,
  NavigationControl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type IControl,
  type PaddingOptions,
} from "maplibre-gl";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker next to its own script, which bundlers move; point it at the file directly.
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

setWorkerUrl(maplibreWorkerUrl);
import type { Feature, FeatureCollection } from "geojson";
import { circleRing, headingWedge } from "./live";
import type { Outcome } from "./scoring";

export const BASEMAP = "https://tiles.openfreemap.org/styles/dark";
export const BG = "#111112";
export const INK = "#f4f4ed";
export const ROUTE = "#38f2ff";
export const ME = "#3d8bff";

export type LiveState = "off" | "follow" | "free";

/** Map button that turns live location on, re-centres on you, or turns it off. */
class LiveControl implements IControl {
  private box = document.createElement("div");
  private button = document.createElement("button");

  constructor(private onPress: () => void) {}

  onAdd() {
    this.box.className = "maplibregl-ctrl maplibregl-ctrl-group live-ctrl";
    this.button.type = "button";
    this.button.title = "Show my live location";
    this.button.setAttribute("aria-label", "Show my live location");
    this.button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>`;
    this.button.addEventListener("click", () => this.onPress());
    this.box.appendChild(this.button);
    return this.box;
  }

  onRemove() {
    this.box.remove();
  }

  setState(state: LiveState, waiting = false) {
    this.box.dataset.state = state;
    this.box.classList.toggle("waiting", waiting);
    const label = state === "off" ? "Show my live location" : state === "free" ? "Centre on my location" : "Turn off live location";
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("aria-pressed", String(state !== "off"));
  }
}

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
  /** A rival level with the holder, shown as a dot in its colour (like strods.uk). */
  level?: number;
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
  private data: Record<string, FC> = {
    hexes: empty(),
    level: empty(),
    mine: empty(),
    reached: empty(),
    covered: empty(),
    selected: empty(),
    hover: empty(),
    route: empty(),
    me: empty(),
  };
  private live: LiveControl | null = null;

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
    this.map.on("moveend", () => {
      if (this.followZoom !== null && Math.abs(this.map.getZoom() - this.followZoom) < 0.05) this.followZoom = null;
    });
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
        this.map.addLayer(
          {
            id: "level-dot",
            type: "circle",
            source: "level",
            minzoom: 9,
            paint: {
              "circle-color": INK,
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.5, 13, 7, 16, 10],
              "circle-stroke-color": BG,
              "circle-stroke-width": 1,
            },
          },
          below,
        );
        this.map.addLayer(
          {
            id: "mine",
            type: "line",
            source: "mine",
            minzoom: 9,
            paint: { "line-color": INK, "line-width": 2, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
          },
          below,
        );
        this.map.addLayer({ id: "reached", type: "fill", source: "reached", paint: { "fill-color": ROUTE, "fill-opacity": 0.22 } }, below);
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
        // You, on top of everything: accuracy circle, heading wedge, dot.
        this.map.addLayer({ id: "me-accuracy", type: "fill", source: "me", filter: ["==", ["get", "kind"], "accuracy"], paint: { "fill-color": ME, "fill-opacity": 0.14 } });
        this.map.addLayer({
          id: "me-accuracy-edge",
          type: "line",
          source: "me",
          filter: ["==", ["get", "kind"], "accuracy"],
          paint: { "line-color": ME, "line-width": 1, "line-opacity": 0.5 },
        });
        this.map.addLayer({ id: "me-heading", type: "fill", source: "me", filter: ["==", ["get", "kind"], "heading"], paint: { "fill-color": ME, "fill-opacity": 0.55 } });
        this.map.addLayer({
          id: "me-dot",
          type: "circle",
          source: "me",
          filter: ["==", ["get", "kind"], "dot"],
          paint: { "circle-radius": 7, "circle-color": ME, "circle-stroke-color": "#fff", "circle-stroke-width": 2.5, "circle-opacity": ["get", "opacity"] },
        });
        this.loaded = true;
        this.applyView();
        // On phones, start with the attribution folded into its (i) button.
        if (matchMedia("(max-width: 760px)").matches) {
          // The attribution text fills in after the first render, which also expands it.
          this.map.once("idle", () => {
            this.map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
          });
        }
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

  private teamColourExpr(prop: string): ExpressionSpecification | string {
    return this.teamColours.length
      ? (["match", ["get", prop], ...this.teamColours.flatMap((c, i) => [i, c]), INK] as unknown as ExpressionSpecification)
      : INK;
  }

  private applyView() {
    if (!this.loaded) return;
    this.map.setPaintProperty("level-dot", "circle-color", this.teamColourExpr("team"));
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
    this.put("level", {
      type: "FeatureCollection",
      features: hexes
        .filter((h) => h.level !== undefined)
        .map((h) => {
          const [lat, lng] = cellToLatLng(h.cell);
          return { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { team: h.level } } as Feature;
        }),
    });
  }



  /** Dashed outlines on hexagons you've crossed that routes are skipping. */
  setMine(cells: Iterable<string>) {
    this.put("mine", { type: "FeatureCollection", features: [...cells].map(hexOutline) });
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

  /** Adds the live location button; `onPress` decides what a press does. */
  addLiveButton(onPress: () => void) {
    this.live = new LiveControl(onPress);
    this.map.addControl(this.live, "top-right");
    this.live.setState("off");
  }

  setLiveState(state: LiveState, waiting = false) {
    this.live?.setState(state, waiting);
  }

  /** Draws you at a position; `stale` fades the dot when the fix is old. */
  setMe(fix: { lat: number; lng: number; accuracy: number; heading: number | null; stale?: boolean } | null) {
    if (!fix) return this.put("me", empty());
    const { lat, lng, accuracy, heading } = fix;
    const features: Feature[] = [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(lat, lng, Math.max(accuracy, 3))] }, properties: { kind: "accuracy" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { kind: "dot", opacity: fix.stale ? 0.45 : 1 } },
    ];
    if (heading !== null && Number.isFinite(heading)) {
      features.splice(1, 0, { type: "Feature", geometry: { type: "Polygon", coordinates: [headingWedge(lat, lng, heading)] }, properties: { kind: "heading" } });
    }
    this.put("me", { type: "FeatureCollection", features });
  }

  setReached(cells: Iterable<string>) {
    this.put("reached", { type: "FeatureCollection", features: [...cells].map((c) => hexPolygon(c)) });
  }

  /**
   * Moves the camera to you without changing zoom (or zooms in on the first fix), keeping you
   * in the part of the map below `topInset` pixels so the live card doesn't cover you.
   */
  follow(lat: number, lng: number, first: boolean, topInset = 0) {
    const padding = { top: topInset, bottom: 0, left: 0, right: 0 };
    // Keep heading for street level until we get there, even if the next fix interrupts.
    if (first) this.followZoom = Math.max(this.map.getZoom(), 15);
    const zoom = this.followZoom ?? undefined;
    this.map.easeTo({ center: [lng, lat], zoom, duration: first ? 1000 : 600, padding });
  }
  private followZoom: number | null = null;

  /** Undo the inset `follow` leaves on the camera. */
  clearInset() {
    this.map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  }

  /** Calls back when the person drags the map themselves. */
  onUserPan(cb: () => void) {
    this.map.on("dragstart", (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) cb();
    });
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

  fitCoords(coords: [number, number][], maxZoom = 14, padding: number | PaddingOptions = 60) {
    if (!coords.length) return;
    const b = new LngLatBounds(coords[0], coords[0]);
    coords.forEach((c) => b.extend(c));
    this.map.fitBounds(b, { padding, maxZoom, duration: 1200 });
  }

  fitBounds(bounds: [number, number, number, number], padding: number | PaddingOptions = 40) {
    this.map.fitBounds(bounds, { padding, maxZoom: 13.5, duration: 1200 });
  }
}
