/** A GPX 1.1 track, which Garmin Connect and Strava can import as a course / route. */
export function toGpx(coords: [number, number][], name: string): string {
  const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = coords.map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="land-grab-router" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name></metadata>
  <trk>
    <name>${esc(name)}</name>
    <type>running</type>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
