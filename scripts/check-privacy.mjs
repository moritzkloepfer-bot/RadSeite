#!/usr/bin/env node
/**
 * Prüft die gebaute Seite (dist/):
 *  - kein veröffentlichter Koordinatenpunkt liegt in der Privatzone
 *  - keine ausgelieferte Bilddatei enthält GPS-Daten
 * Aufruf nach dem Build: npm run check-privacy
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';

try {
  process.loadEnvFile('.env');
} catch {
  // keine .env – dann nur Umgebungsvariablen (z. B. in GitHub Actions)
}

const lat0 = parseFloat(process.env.PRIVACY_LAT ?? '');
const lon0 = parseFloat(process.env.PRIVACY_LON ?? '');
const radius = parseFloat(process.env.PRIVACY_RADIUS_M ?? '') || 500;
const zone = Number.isFinite(lat0) && Number.isFinite(lon0) ? { lat: lat0, lon: lon0 } : null;

const rad = (g) => (g * Math.PI) / 180;
function abstandM(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

async function* dateien(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* dateien(p);
    else yield p;
  }
}

const entities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Sammelt Koordinaten aus den Karten-/Profildaten: [lat,lon], [km,ele,lat,lon], {lat,lon}. */
function koordinaten(wert, aus = []) {
  if (Array.isArray(wert)) {
    if (wert.length === 2 && wert.every((x) => typeof x === 'number')) aus.push({ lat: wert[0], lon: wert[1] });
    else if (wert.length === 4 && wert.every((x) => typeof x === 'number')) aus.push({ lat: wert[2], lon: wert[3] });
    else wert.forEach((w) => koordinaten(w, aus));
  } else if (wert && typeof wert === 'object') {
    if (typeof wert.lat === 'number' && typeof wert.lon === 'number') aus.push(wert);
    Object.values(wert).forEach((w) => koordinaten(w, aus));
  }
  return aus;
}

let punkte = 0;
let verstoesse = 0;
let bilder = 0;
let bilderMitGps = 0;

for await (const datei of dateien('dist')) {
  const ext = path.extname(datei).toLowerCase();
  if (ext === '.html') {
    const html = await readFile(datei, 'utf-8');
    for (const m of html.matchAll(/data-(?:tourkarte|uebersicht|profil)="([^"]*)"/g)) {
      for (const p of koordinaten(JSON.parse(entities(m[1])))) {
        punkte++;
        if (zone && abstandM(p, zone) <= radius) {
          verstoesse++;
          console.error(`✗ ${datei}: Punkt ${p.lat},${p.lon} liegt in der Privatzone`);
        }
      }
    }
  } else if (ext === '.gpx') {
    const gpx = await readFile(datei, 'utf-8');
    for (const m of gpx.matchAll(/lat="([-\d.]+)" lon="([-\d.]+)"/g)) {
      punkte++;
      const p = { lat: +m[1], lon: +m[2] };
      if (zone && abstandM(p, zone) <= radius) {
        verstoesse++;
        console.error(`✗ ${datei}: Punkt ${p.lat},${p.lon} liegt in der Privatzone`);
      }
    }
    if (/<time>/.test(gpx)) {
      verstoesse++;
      console.error(`✗ ${datei}: enthält Zeitstempel`);
    }
  } else if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext)) {
    bilder++;
    const gps = await exifr.gps(datei).catch(() => undefined);
    if (gps?.latitude != null) {
      bilderMitGps++;
      console.error(`✗ ${datei}: enthält GPS-Daten`);
    }
  }
}

if (!zone) console.warn('⚠ Keine Privatzone konfiguriert (PRIVACY_LAT/PRIVACY_LON) – Positionsprüfung übersprungen.');
console.log(`${punkte} Koordinaten geprüft, ${verstoesse} Verstöße · ${bilder} Bilder geprüft, ${bilderMitGps} mit GPS`);
process.exit(verstoesse + bilderMitGps > 0 ? 1 : 0);
