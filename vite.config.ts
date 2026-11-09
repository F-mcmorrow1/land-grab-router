import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages serves the app from /land-grab-router/, so the production build (and
  // `vite preview` of it) needs that prefix. Dev stays at '/'. To host at a domain root,
  // build with LGR_BASE=/.
  base: command === "build" || isPreview ? (process.env.LGR_BASE ?? "/land-grab-router/") : "/",
  build: {
    // MapLibre is ~1 MB on its own; the default 500 kB warning isn't useful here.
    chunkSizeWarningLimit: 1600,
  },
}));
