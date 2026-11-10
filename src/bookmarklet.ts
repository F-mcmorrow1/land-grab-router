/**
 * The "Send to Land Grab Router" bookmark.
 *
 * strods.uk's API only answers pages on strods.uk, so the planner can't fetch the data itself.
 * A bookmark runs as part of whatever page you're on, so clicked on strods.uk it can: it fetches
 * the land-grab data with your existing login, opens the planner in a new tab and hands the data
 * over with postMessage. Nothing goes through any server.
 *
 * `sendToPlanner` is turned into the bookmark with `.toString()`, so it must stay self-contained:
 * no imports, no helpers from outside it, only browser globals and its argument.
 */
export async function sendToPlanner(planner: string): Promise<void> {
  const say = (msg: string) => alert("Land Grab Router: " + msg);
  if (location.hostname !== "strods.uk") {
    say("opening strods.uk. Once it has loaded, click the bookmark again.");
    location.href = "https://strods.uk/overview";
    return;
  }

  // The page has already called the API for your club; find its ID in those requests.
  let club: string | null = null;
  for (const entry of performance.getEntriesByType("resource")) {
    const m = /api\.strods\.uk\/clubs\/(\d+)/.exec(entry.name);
    if (m) club = m[1];
  }
  try {
    club = club || localStorage.getItem("lgr-club-id");
  } catch {
    /* storage blocked */
  }
  if (!club) {
    say("couldn't find your club yet. Wait for the Club Overview page to load, then click the bookmark again.");
    if (!location.pathname.startsWith("/overview")) location.href = "/overview";
    return;
  }
  try {
    localStorage.setItem("lgr-club-id", club);
  } catch {
    /* fine: we'll find it again next time */
  }

  // Open the tab straight away, while the click still counts, or pop-up blockers step in.
  const target = new URL(planner).origin;
  const win = window.open(planner + "#import", "land-grab-router");
  if (!win) {
    say("your browser blocked the new tab. Allow pop-ups for strods.uk, then click the bookmark again.");
    return;
  }

  let ready = false;
  let payload: { type: "lgr-data"; json: string } | { type: "lgr-error"; message: string } | null = null;
  const send = () => {
    if (!ready || !payload) return;
    win.postMessage(payload, target);
    removeEventListener("message", onMessage);
  };
  const onMessage = (e: MessageEvent) => {
    if (e.origin === target && e.source === win && e.data && e.data.type === "lgr-ready") {
      ready = true;
      send();
    }
  };
  addEventListener("message", onMessage);

  try {
    const res = await fetch("https://api.strods.uk/clubs/" + club + "/land-grab", { credentials: "include" });
    if (res.status === 401 || res.status === 403) throw new Error("you're signed out of strods.uk. Sign in, then click the bookmark again");
    if (!res.ok) throw new Error("strods.uk replied " + res.status + (res.status >= 500 ? ", so the land grab may not be running right now" : ""));
    payload = { type: "lgr-data", json: await res.text() };
  } catch (err) {
    payload = { type: "lgr-error", message: err instanceof Error ? err.message : String(err) };
  }
  send();
}

/** The bookmark's address, for a link people drag to their bookmarks bar. */
export function bookmarkletHref(plannerUrl: string): string {
  return "javascript:" + encodeURIComponent(`(${sendToPlanner.toString()})(${JSON.stringify(plannerUrl)})`);
}

/** The origin the planner accepts imported data from. */
export const STRODS_ORIGIN = "https://strods.uk";

interface ImportHooks {
  onData(json: string): void;
  onError(message: string): void;
  onTimeout(): void;
}

/**
 * The planner's half of the hand-over: keep telling the strods.uk tab that opened us we're
 * ready, and take the first message it sends back. Anything from another origin or window is
 * ignored. Returns a function that stops listening.
 */
export function receiveImport(
  self: Pick<Window, "addEventListener" | "removeEventListener">,
  opener: { postMessage(message: unknown, targetOrigin: string): void },
  hooks: ImportHooks,
  timeoutMs = 30_000,
): () => void {
  const ping = () => {
    try {
      opener.postMessage({ type: "lgr-ready" }, STRODS_ORIGIN);
    } catch {
      /* the strods.uk tab was closed */
    }
  };
  const onMessage = (e: Event) => {
    const { origin, source, data } = e as MessageEvent;
    if (origin !== STRODS_ORIGIN || source !== opener) return;
    const msg = data as { type?: string; json?: unknown; message?: unknown } | null;
    if (msg?.type === "lgr-data" && typeof msg.json === "string") {
      stop();
      hooks.onData(msg.json);
    } else if (msg?.type === "lgr-error") {
      stop();
      hooks.onError(String(msg.message));
    }
  };
  const timer = setInterval(ping, 500);
  const deadline = setTimeout(() => {
    stop();
    hooks.onTimeout();
  }, timeoutMs);
  function stop() {
    clearInterval(timer);
    clearTimeout(deadline);
    self.removeEventListener("message", onMessage);
  }
  self.addEventListener("message", onMessage);
  ping();
  return stop;
}
