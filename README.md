# Land Grab Router

Plans running (or riding) routes for the strods.uk "land grab" challenge, where crossing an
H3 hexagon claims it for your team. It rebuilds the live map from the same data the site
uses, then finds either:

- **Most points**: the route within your distance budget that wins the most, counting
  unclaimed ground, hexagons you can take off rivals (extra credit for blocking the leaders),
  hexagons of yours that are at risk, and progress towards ones you can't take yet.
- **Through chosen hexagons**: the shortest street route that enters every hexagon you
  click.

Routes follow real streets and paths, and export as GPX for Garmin Connect or Strava.

It only opens for data downloaded by a member of **Worst Pace Scenario** (team 29), and always
plans for that team. Data from any other team gets a mock crash screen and isn't kept. The
check is in `src/team.ts`. It runs in the browser and this repo is public, so it's a deterrent,
not security.

Not affiliated with strods.uk.

## Run it

```bash
npm install
npm run dev
```

Then click **Try demo data** to play with a generated week, or load your real data (below).

```bash
npm test         # game rules, scoring, street graph and solvers
npm run build    # production build in dist/
```

## Getting your live data

The API (`https://api.strods.uk/clubs/{clubId}/land-grab`) authenticates with your
browser's login cookie, so this app can't call it directly. Instead:

1. Open <https://strods.uk/overview> while signed in.
2. Open DevTools, go to **Network**, and filter for `land-grab` (reload if it's empty).
3. Right-click the request, then **Copy → Copy response**.
4. Paste it into **Game data → Paste JSON**, or save it as a `.json` file and load that.

There's a fuller guide (Firefox and Safari, shortcuts, phones, troubleshooting) at
[`public/how-to.html`](public/how-to.html), served as `how-to.html` next to the app.

The data (including other athletes' first names) stays in your browser's local storage.
`data/*.json` is git-ignored if you keep copies in the project.

## How it works

| Piece | Where | Notes |
| --- | --- | --- |
| Map | `src/map.ts` | MapLibre GL with OpenFreeMap's dark style, recoloured the way strods.uk does it. Hexagon fill, gap lines, route and selection layers. |
| Game rules | `src/data/replay.ts` | Replays every crossing of the week in time order. A team takes a hexagon with more crossings than the holder, or the same number if it got there first. Matches the site's client code. |
| Scoring | `src/scoring.ts` | What one more run does to each hexagon for your team: claim, steal, siege, defend or secure, with adjustable weights. A property test checks the projected standings against a full replay. |
| Streets | `src/graph/tiles.ts` | Roads and paths from the `transportation` layer of OpenFreeMap's zoom-14 vector tiles (fast, CDN-hosted). Tiles are lightly simplified and cut at edges, so junctions are repaired: loose ends within ~1.5 m are joined, as are streets crossing at street level (not bridges or tunnels). Falls back to the Overpass API if tiles fail. |
| Graph | `src/graph/graph.ts` | Compressed-sparse-row street graph; every node and long segment is tagged with its H3 cell. |
| Most points | `src/solve/maxScore.ts` | Orienteering heuristic: greedy points-per-metre insertion, 2-opt / or-opt, real street stitching that credits hexagons passed on the way, pruning of stops that became free, tightening, then out-and-back spurs to use leftover distance. Several starting shapes are tried and the best is kept. |
| Through chosen | `src/solve/visitAll.ts` | Orders the hexagons (nearest neighbour + 2-opt + or-opt), enters each one at whichever of its streets suits the legs either side, then tightens. |
| Tightening | `src/solve/tighten.ts` | A hexagon counts once the route is safely inside it, so going deeper is wasted. Each stop moves to the cheapest point in its hexagon given its neighbours, and stops the rest of the route already covers are dropped; changes are kept only if nothing is lost. On London streets this wins 5–20% more ground per kilometre. |
| Worker | `src/worker.ts` | Downloads and solves off the main thread. |

## Assumptions worth knowing

- **One visit per run.** A run counts once per hexagon even if it crosses it twice. The
  site's data lists cells per activity; if it ever counts repeat crossings, loops that
  double back would be worth more than this planner thinks.
- **15 m GPS margin.** A hexagon only counts, and is only used as a target, where the
  route gets at least 15 m inside its edges. Change `MARGIN` in `src/graph/graph.ts`.
- **Pavements.** Pavements mapped as separate footways aren't in the tiles; the road next
  to them is, so routes run along the road.
- **Street search area.** "Most points" looks within 5 km of the start (`MAX_RADIUS` in
  `src/main.ts`), which covers loops up to roughly 25–30 km.
- **Standings move.** Data is a snapshot. Re-copy it before you head out if others have
  been running.
