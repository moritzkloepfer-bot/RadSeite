import { DOMParser } from '@xmldom/xmldom';
import simplify from 'simplify-js';
import { abstandM, inZone, type Privatzone } from './geo';

export interface TrackPunkt {
  lat: number;
  lon: number;
  /** Höhe in m, falls im GPX vorhanden */
  ele: number | null;
  /** Zeitpunkt in ms seit Epoche (UTC), nur bei aufgezeichneten Touren */
  zeit: number | null;
  /** Kumulierte Strecke ab Start in km (bezogen auf den vollständigen Track) */
  km: number;
}

export interface Track {
  name: string | null;
  punkte: TrackPunkt[];
}

export interface Kennzahlen {
  distanzKm: number;
  aufstiegM: number;
  abstiegM: number;
  maxHoeheM: number | null;
  minHoeheM: number | null;
  /** Maximale Steigung in %, gemittelt über mind. 200 m */
  maxSteigungProzent: number | null;
  /** Tatsächliche Dauer (erster bis letzter Zeitstempel) in Minuten */
  dauerMin: number | null;
  /** Grobe Schätzung: 20 km/h in der Ebene + 1 h je 600 Hm */
  geschaetztMin: number;
  hatZeitstempel: boolean;
}

/** Parst eine GPX-Datei (Tracks und – falls keine vorhanden – Routen). */
export function parseGpx(xml: string): Track {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  let knoten = Array.from(doc.getElementsByTagName('trkpt'));
  if (knoten.length === 0) knoten = Array.from(doc.getElementsByTagName('rtept'));

  const nameEl = doc.getElementsByTagName('name')[0];
  const name = nameEl?.textContent?.trim() || null;

  const punkte: TrackPunkt[] = [];
  let km = 0;
  for (const k of knoten) {
    const lat = parseFloat(k.getAttribute('lat') ?? '');
    const lon = parseFloat(k.getAttribute('lon') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const eleText = k.getElementsByTagName('ele')[0]?.textContent;
    const zeitText = k.getElementsByTagName('time')[0]?.textContent;
    const ele = eleText != null && eleText.trim() !== '' ? parseFloat(eleText) : null;
    const zeit = zeitText ? Date.parse(zeitText.trim()) : NaN;
    const vorher = punkte[punkte.length - 1];
    if (vorher) km += abstandM(vorher, { lat, lon }) / 1000;
    punkte.push({
      lat,
      lon,
      ele: ele != null && Number.isFinite(ele) ? ele : null,
      zeit: Number.isFinite(zeit) ? zeit : null,
      km,
    });
  }
  return { name, punkte };
}

/**
 * Entfernt alle Punkte innerhalb der Privatzone. Die km-Werte der übrigen
 * Punkte bleiben unverändert, damit Kennzahlen und Profil zur echten Tour passen.
 */
export function privatzoneKuerzen(punkte: TrackPunkt[], zone: Privatzone | null): TrackPunkt[] {
  if (!zone) return punkte;
  return punkte.filter((p) => !inZone(p, zone));
}

/** Höhendifferenzen mit Hysterese summieren, damit GPS-Rauschen nicht mitzählt. */
function hoehenmeter(punkte: TrackPunkt[], schwelleM = 4): { auf: number; ab: number } {
  let auf = 0;
  let ab = 0;
  let referenz: number | null = null;
  for (const p of punkte) {
    if (p.ele == null) continue;
    if (referenz == null) {
      referenz = p.ele;
      continue;
    }
    const d = p.ele - referenz;
    if (d >= schwelleM) {
      auf += d;
      referenz = p.ele;
    } else if (d <= -schwelleM) {
      ab -= d;
      referenz = p.ele;
    }
  }
  return { auf, ab };
}

function maxSteigung(punkte: TrackPunkt[], fensterKm = 0.2): number | null {
  const mitHoehe = punkte.filter((p) => p.ele != null);
  let max: number | null = null;
  let j = 0;
  for (let i = 0; i < mitHoehe.length; i++) {
    if (j < i) j = i;
    while (j < mitHoehe.length && mitHoehe[j].km - mitHoehe[i].km < fensterKm) j++;
    if (j >= mitHoehe.length) break;
    const strecke = (mitHoehe[j].km - mitHoehe[i].km) * 1000;
    const steigung = ((mitHoehe[j].ele! - mitHoehe[i].ele!) / strecke) * 100;
    if (max == null || steigung > max) max = steigung;
  }
  return max;
}

export function kennzahlen(punkte: TrackPunkt[]): Kennzahlen {
  const distanzKm = punkte.length ? punkte[punkte.length - 1].km - punkte[0].km : 0;
  const { auf, ab } = hoehenmeter(punkte);
  const hoehen = punkte.map((p) => p.ele).filter((e): e is number => e != null);
  const zeiten = punkte.map((p) => p.zeit).filter((z): z is number => z != null);
  const hatZeitstempel = zeiten.length >= 2;
  return {
    distanzKm,
    aufstiegM: Math.round(auf),
    abstiegM: Math.round(ab),
    maxHoeheM: hoehen.length ? Math.round(Math.max(...hoehen)) : null,
    minHoeheM: hoehen.length ? Math.round(Math.min(...hoehen)) : null,
    maxSteigungProzent: maxSteigung(punkte),
    dauerMin: hatZeitstempel ? Math.round((zeiten[zeiten.length - 1] - zeiten[0]) / 60000) : null,
    geschaetztMin: Math.round((distanzKm / 20 + auf / 600) * 60),
    hatZeitstempel,
  };
}

/** Douglas-Peucker-Vereinfachung; gibt Punkte des Eingabe-Arrays zurück. */
export function vereinfachen(punkte: TrackPunkt[], toleranzGrad = 0.00015): TrackPunkt[] {
  if (punkte.length < 3) return punkte;
  const eingabe = punkte.map((p, i) => ({ x: p.lon, y: p.lat, i }));
  const ergebnis = simplify(eingabe, toleranzGrad, true) as typeof eingabe;
  return ergebnis.map((e) => punkte[e.i]);
}

export interface ProfilPunkt {
  km: number;
  ele: number;
  lat: number;
  lon: number;
}

/** Tastet den Track in gleichmäßigen km-Abständen für das Höhenprofil ab. */
export function profil(punkte: TrackPunkt[], anzahl = 300): ProfilPunkt[] {
  const mitHoehe = punkte.filter((p) => p.ele != null);
  if (mitHoehe.length < 2) return [];
  const start = mitHoehe[0].km;
  const ende = mitHoehe[mitHoehe.length - 1].km;
  const ergebnis: ProfilPunkt[] = [];
  let j = 0;
  for (let n = 0; n < anzahl; n++) {
    const km = start + ((ende - start) * n) / (anzahl - 1);
    while (j < mitHoehe.length - 2 && mitHoehe[j + 1].km < km) j++;
    const a = mitHoehe[j];
    const b = mitHoehe[j + 1];
    const t = b.km === a.km ? 0 : Math.min(1, Math.max(0, (km - a.km) / (b.km - a.km)));
    ergebnis.push({
      km,
      ele: a.ele! + (b.ele! - a.ele!) * t,
      lat: a.lat + (b.lat - a.lat) * t,
      lon: a.lon + (b.lon - a.lon) * t,
    });
  }
  return ergebnis;
}

const xmlEsc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Schreibt die (gekürzten) Punkte als GPX 1.1 – ohne Zeitstempel. */
export function alsGpx(name: string, punkte: TrackPunkt[]): string {
  const pts = punkte
    .map(
      (p) =>
        `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">` +
        (p.ele != null ? `<ele>${p.ele.toFixed(1)}</ele>` : '') +
        `</trkpt>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RadSeite" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${xmlEsc(name)}</name></metadata>
  <trk>
    <name>${xmlEsc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
