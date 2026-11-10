/**
 * The bottom sheet that holds the controls on phones. It has three resting places: "peek" (just
 * the summary and Plan button), "half" and "full". Drag the top bar to move it; a flick carries it
 * to the next stop; a tap on the summary steps through the stops.
 */

export type SheetState = "peek" | "half" | "full";

/** How far the sheet is pushed down from fully open, in pixels, at each stop. */
export type Stops = Record<SheetState, number>;

const ORDER: SheetState[] = ["full", "half", "peek"]; // increasing offset

/**
 * Where a drag should settle. `offset` is where the finger let go; `velocity` is in px/ms,
 * positive when moving down. A flick goes to the next stop that way; a slow release goes to the
 * nearest stop.
 */
export function settle(offset: number, velocity: number, stops: Stops): SheetState {
  if (velocity > 0.4) return ORDER.find((s) => stops[s] > offset + 1) ?? "peek";
  if (velocity < -0.4) return [...ORDER].reverse().find((s) => stops[s] < offset - 1) ?? "full";
  return ORDER.reduce((best, s) => (Math.abs(stops[s] - offset) < Math.abs(stops[best] - offset) ? s : best), "peek" as SheetState);
}

/** The stop a tap moves to. */
export const nextStop = (s: SheetState): SheetState => (s === "peek" ? "half" : s === "half" ? "full" : "peek");

export class Sheet {
  state: SheetState = "peek";
  private mq = matchMedia("(max-width: 760px)");
  private probe = document.createElement("div");

  constructor(
    private panel: HTMLElement,
    private head: HTMLElement,
    private summary: HTMLElement,
    private onChange?: (state: SheetState) => void,
  ) {
    // Measures the home-indicator gap, which CSS knows but JavaScript can't read directly.
    this.probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom);width:0;visibility:hidden;pointer-events:none";
    document.body.appendChild(this.probe);
    head.addEventListener("pointerdown", this.onDown);
    // Keyboard users: Enter / Space on the summary steps through the stops.
    summary.addEventListener("click", (e) => {
      if ((e as MouseEvent).detail === 0) this.set(nextStop(this.state));
    });
    addEventListener("resize", () => this.apply());
    this.mq.addEventListener("change", () => this.apply());
    this.apply();
  }

  /** True when the sheet layout is in use (narrow screens). */
  get active() {
    return this.mq.matches;
  }

  /** Pixels at the bottom of the map hidden behind the sheet at its current stop. */
  covered() {
    if (!this.active) return 0;
    return this.panel.offsetHeight - this.stops()[this.state];
  }

  private stops(): Stops {
    const h = this.panel.offsetHeight;
    const peekVisible = this.head.offsetHeight + this.probe.offsetHeight;
    const halfVisible = Math.min(h, Math.round(innerHeight * 0.52));
    return { full: 0, half: Math.max(0, h - halfVisible), peek: Math.max(0, h - peekVisible) };
  }

  set(state: SheetState) {
    const changed = state !== this.state;
    this.state = state;
    this.apply();
    if (changed) this.onChange?.(state);
  }

  private apply() {
    if (!this.active) {
      this.panel.style.removeProperty("--sheet-offset");
      delete this.panel.dataset.sheet;
      return;
    }
    const stops = this.stops();
    this.panel.style.setProperty("--sheet-offset", `${stops[this.state]}px`);
    this.panel.dataset.sheet = this.state;
    document.documentElement.style.setProperty("--peek-h", `${this.panel.offsetHeight - stops.peek}px`);
    this.summary.setAttribute("aria-expanded", String(this.state !== "peek"));
    if (this.state === "peek") this.panel.scrollTop = 0;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.active || (e.target as HTMLElement).closest("#sheet-plan")) return;
    const stops = this.stops();
    const startY = e.clientY;
    const start = stops[this.state];
    let offset = start;
    let lastY = startY;
    let lastT = performance.now();
    let velocity = 0;
    this.head.setPointerCapture(e.pointerId);
    this.panel.classList.add("dragging");

    const move = (ev: PointerEvent) => {
      const now = performance.now();
      velocity = (ev.clientY - lastY) / Math.max(1, now - lastT);
      lastY = ev.clientY;
      lastT = now;
      offset = Math.min(stops.peek, Math.max(0, start + ev.clientY - startY));
      this.panel.style.setProperty("--sheet-offset", `${offset}px`);
    };
    const up = (ev: PointerEvent) => {
      this.head.removeEventListener("pointermove", move);
      this.head.removeEventListener("pointerup", up);
      this.head.removeEventListener("pointercancel", up);
      this.panel.classList.remove("dragging");
      if (Math.abs(ev.clientY - startY) < 6) this.set(nextStop(this.state));
      else this.set(settle(offset, velocity, stops));
      this.apply();
    };
    this.head.addEventListener("pointermove", move);
    this.head.addEventListener("pointerup", up);
    this.head.addEventListener("pointercancel", up);
  };
}
