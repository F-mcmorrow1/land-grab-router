import { afterEach, describe, expect, it, vi } from "vitest";
import { bookmarkletHref, receiveImport, sendToPlanner } from "../src/bookmarklet";

const PLANNER = "https://theimitation.github.io/land-grab-router/";

/** A pretend strods.uk page for the bookmark to run in. */
function strods(opts: { host?: string; path?: string; entries?: string[]; fetch?: () => Promise<Response>; open?: boolean } = {}) {
  const loc = { hostname: opts.host ?? "strods.uk", pathname: opts.path ?? "/overview", href: "" };
  const win = { postMessage: vi.fn() };
  const listeners: ((e: unknown) => void)[] = [];
  const alerts: string[] = [];
  const store = new Map<string, string>();
  vi.stubGlobal("location", loc);
  vi.stubGlobal("performance", { getEntriesByType: () => (opts.entries ?? []).map((name) => ({ name })) });
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
  vi.stubGlobal("alert", (m: string) => alerts.push(m));
  vi.stubGlobal("window", { open: vi.fn(() => (opts.open === false ? null : win)) });
  vi.stubGlobal("addEventListener", (_: string, fn: (e: unknown) => void) => listeners.push(fn));
  vi.stubGlobal("removeEventListener", () => listeners.splice(0));
  vi.stubGlobal("fetch", vi.fn(opts.fetch ?? (async () => new Response('{"teams":[]}', { status: 200 }))));
  const ready = () => listeners.forEach((fn) => fn({ origin: new URL(PLANNER).origin, source: win, data: { type: "lgr-ready" } }));
  return { loc, win, alerts, store, ready };
}

afterEach(() => vi.unstubAllGlobals());

describe("Send to Land Grab Router bookmark", () => {
  it("fetches your club's data and hands it to the planner once it's ready", async () => {
    const page = strods({ entries: ["https://api.strods.uk/clubs/1234/leaderboard?date=x"] });
    const done = sendToPlanner(PLANNER);
    expect(window.open).toHaveBeenCalledWith(PLANNER + "#import", "land-grab-router");
    await done;
    expect(fetch).toHaveBeenCalledWith("https://api.strods.uk/clubs/1234/land-grab", { credentials: "include" });
    expect(page.win.postMessage).not.toHaveBeenCalled(); // planner hasn't said it's ready yet
    page.ready();
    expect(page.win.postMessage).toHaveBeenCalledWith({ type: "lgr-data", json: '{"teams":[]}' }, "https://theimitation.github.io");
    expect(page.store.get("lgr-club-id")).toBe("1234");
  });

  it("remembers the club for pages that haven't called the API", async () => {
    const page = strods();
    page.store.set("lgr-club-id", "77");
    await sendToPlanner(PLANNER);
    expect(fetch).toHaveBeenCalledWith("https://api.strods.uk/clubs/77/land-grab", { credentials: "include" });
  });

  it("tells the planner when you're signed out", async () => {
    const page = strods({ entries: ["https://api.strods.uk/clubs/9/x"], fetch: async () => new Response("", { status: 401 }) });
    page.ready();
    await sendToPlanner(PLANNER);
    page.ready();
    const [msg] = page.win.postMessage.mock.calls[0];
    expect(msg.type).toBe("lgr-error");
    expect(msg.message).toMatch(/signed out/);
  });

  it("sends you to strods.uk when clicked anywhere else", async () => {
    const page = strods({ host: "example.com" });
    await sendToPlanner(PLANNER);
    expect(page.loc.href).toBe("https://strods.uk/overview");
    expect(window.open).not.toHaveBeenCalled();
  });

  it("asks for the overview page when it can't find the club", async () => {
    const page = strods({ path: "/teams" });
    await sendToPlanner(PLANNER);
    expect(page.alerts[0]).toMatch(/couldn't find your club/);
    expect(page.loc.href).toBe("/overview");
  });

  it("explains a blocked pop-up", async () => {
    const page = strods({ entries: ["https://api.strods.uk/clubs/9/x"], open: false });
    await sendToPlanner(PLANNER);
    expect(page.alerts[0]).toMatch(/blocked the new tab/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes a bookmark address that is valid JavaScript", () => {
    const href = bookmarkletHref(PLANNER);
    expect(href.startsWith("javascript:")).toBe(true);
    const code = decodeURIComponent(href.slice("javascript:".length));
    expect(() => new Function(code)).not.toThrow();
    expect(code).toContain(JSON.stringify(PLANNER));
  });
});

describe("planner side of the hand-over", () => {
  function setup() {
    vi.useFakeTimers();
    const listeners: ((e: Event) => void)[] = [];
    const self = { addEventListener: (_: string, fn: (e: Event) => void) => listeners.push(fn), removeEventListener: () => listeners.splice(0) };
    const opener = { postMessage: vi.fn() };
    const hooks = { onData: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() };
    const deliver = (origin: string, source: unknown, data: unknown) => [...listeners].forEach((fn) => fn({ origin, source, data } as unknown as Event));
    return { self, opener, hooks, deliver, listeners };
  }
  afterEach(() => vi.useRealTimers());

  it("keeps saying it's ready to strods.uk until the data comes", async () => {
    const t = setup();
    receiveImport(t.self as never, t.opener, t.hooks);
    expect(t.opener.postMessage).toHaveBeenCalledWith({ type: "lgr-ready" }, "https://strods.uk");
    vi.advanceTimersByTime(1600);
    expect(t.opener.postMessage).toHaveBeenCalledTimes(4);
    t.deliver("https://strods.uk", t.opener, { type: "lgr-data", json: '{"teams":[]}' });
    expect(t.hooks.onData).toHaveBeenCalledWith('{"teams":[]}');
    vi.advanceTimersByTime(5000);
    expect(t.opener.postMessage).toHaveBeenCalledTimes(4); // stopped
    expect(t.listeners).toHaveLength(0);
  });

  it("ignores messages from other sites and other windows", () => {
    const t = setup();
    receiveImport(t.self as never, t.opener, t.hooks);
    t.deliver("https://evil.example", t.opener, { type: "lgr-data", json: "{}" });
    t.deliver("https://strods.uk", {}, { type: "lgr-data", json: "{}" });
    t.deliver("https://strods.uk", t.opener, { type: "something-else" });
    expect(t.hooks.onData).not.toHaveBeenCalled();
  });

  it("passes on errors and gives up after the timeout", () => {
    const a = setup();
    receiveImport(a.self as never, a.opener, a.hooks);
    a.deliver("https://strods.uk", a.opener, { type: "lgr-error", message: "signed out" });
    expect(a.hooks.onError).toHaveBeenCalledWith("signed out");
    vi.useRealTimers();

    const b = setup();
    receiveImport(b.self as never, b.opener, b.hooks, 2000);
    vi.advanceTimersByTime(2001);
    expect(b.hooks.onTimeout).toHaveBeenCalled();
    expect(b.listeners).toHaveLength(0);
  });
});
