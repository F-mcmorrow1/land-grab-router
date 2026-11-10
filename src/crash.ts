import { OUR_TEAM } from "./team";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CSS = `
  @keyframes lgr-shake {
    0%, 100% { transform: none; filter: none; }
    10% { transform: translate(-6px, 2px) skewX(2deg); filter: hue-rotate(90deg); }
    20% { transform: translate(5px, -3px); filter: invert(1); }
    30% { transform: translate(-3px, 4px) skewX(-3deg); filter: none; }
    45% { transform: translate(7px, 0); filter: saturate(4); }
    60% { transform: translate(-5px, -2px) scale(1.01); filter: invert(1) hue-rotate(180deg); }
    80% { transform: translate(2px, 3px); filter: blur(1px); }
  }
  body.lgr-glitch #app { animation: lgr-shake 0.35s steps(2) infinite; }
  .lgr-crash {
    position: fixed; inset: 0; z-index: 99999; overflow-y: auto;
    background: #0b5cad; color: #fff;
    font: 18px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    padding: max(48px, 8vh) 16px 48px;
  }
  .lgr-crash > div { max-width: 760px; margin: 0 auto; }
  .lgr-crash .face { font-size: clamp(90px, 18vw, 150px); line-height: 1; margin: 0 0 28px; font-weight: 300; }
  .lgr-crash h1 { font: 300 clamp(24px, 4vw, 32px)/1.3 "Segoe UI", system-ui, -apple-system, sans-serif; color: #fff; margin: 0 0 24px; }
  .lgr-crash p { margin: 0 0 16px; }
  .lgr-crash ul { margin: 0 0 24px; padding-left: 20px; }
  .lgr-crash .pct { font-size: 22px; margin: 28px 0; }
  .lgr-crash .small { font-size: 14px; opacity: 0.85; }
  .lgr-crash code { font: inherit; font-weight: 600; letter-spacing: 0.02em; background: none; border: none; padding: 0; }
`;

const DUMP = [
  "Dumping lactic acid",
  "Unlacing shoes",
  "Collecting your splits",
  "Refusing to carb-load",
  "Uploading your excuses",
  "Telling Strava you walked",
  "Untying hexagons",
];

/**
 * Shuts the planner down with a mock "your PC ran into a problem" screen. It only takes over
 * the page; it doesn't loop, hog memory or touch anything else, so the visitor's browser is fine
 * and a reload brings back an empty planner.
 */
export function crash(theirTeam: string | null, shutDown: () => void) {
  try {
    shutDown();
  } catch {
    /* already gone */
  }
  document.title = "Land Grab Router (Not Responding)";
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  console.error(`WRONG_TEAM_EXCEPTION: ${theirTeam ?? "no team"} is not ${OUR_TEAM.name}. The planner has pulled a hamstring.`);

  const who = theirTeam ? `<b>${esc(theirTeam)}</b>` : "<b>no team at all</b>, which is exactly what a spy would say";
  const screen = document.createElement("div");
  screen.className = "lgr-crash";
  screen.setAttribute("role", "alert");
  screen.innerHTML = `<div>
    <p class="face" aria-hidden="true">:(</p>
    <h1>Your route planner ran into a problem: you're on the wrong team.</h1>
    <p>This data says you run for ${who}. Land Grab Router only runs for ${esc(OUR_TEAM.name)}, and it would rather pull a hamstring than help you take our hexagons.</p>
    <ul>
      <li>Hexagons we were about to help you take: 0</li>
      <li>Hexagons we're keeping: all of them</li>
      <li>Suggested fix: run faster. Or ask nicely to join ${esc(OUR_TEAM.name)}.</li>
    </ul>
    <p class="pct" aria-live="polite"><span class="status">Dumping lactic acid</span>: <span class="n">0</span>% complete</p>
    <p class="small">If you call a support person, give them this info:<br />Stop code: <code>WRONG_TEAM_EXCEPTION</code><br />What failed: <code>your_legs.sys</code></p>
  </div>`;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const takeOver = () => {
    document.body.classList.remove("lgr-glitch");
    document.body.replaceChildren(screen);
    const n = screen.querySelector(".n")!;
    const status = screen.querySelector(".status")!;
    let pct = 0;
    const tick = () => {
      pct = Math.min(100, pct + 1 + Math.floor(Math.random() * 9));
      n.textContent = String(pct);
      status.textContent = DUMP[Math.min(DUMP.length - 1, Math.floor((pct / 100) * DUMP.length))];
      if (pct < 100) setTimeout(tick, 250 + Math.random() * 700);
      else screen.querySelector(".pct")!.textContent = "Done. Error report sent to nobody. Restarting is pointless; your legs are the problem.";
    };
    setTimeout(tick, 800);
  };

  if (reduced) takeOver();
  else {
    document.body.classList.add("lgr-glitch");
    setTimeout(takeOver, 1100);
  }
}
