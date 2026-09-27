import { abstandM, inZone, type LatLon, type Privatzone } from './geo';
import type { TrackPunkt } from './gpx';

/** Rohdaten eines Fotos, wie sie aus den EXIF-Daten gelesen wurden. */
export interface FotoMeta {
  datei: string;
  gps: LatLon | null;
  /** Aufnahmezeit ohne Zeitzone, Format „YYYY:MM:DD HH:MM:SS“ */
  zeitLokal: string | null;
  /** Zeitzone aus OffsetTimeOriginal, z. B. „+02:00“ */
  zeitOffset: string | null;
  /** Kamera/Handy (Make + Model), um den Uhrversatz je Gerät zu bestimmen */
  geraet: string | null;
}

export type Quelle = 'manuell' | 'gps' | 'zeit';

export interface VerortetesFoto {
  datei: string;
  /** Position auf dem Track, null wenn nicht verortbar oder in der Privatzone */
  position: (LatLon & { km: number }) | null;
  quelle: Quelle | null;
  /** Korrigierte Aufnahmezeit (UTC, ms) für die Sortierung */
  zeit: number | null;
  /** Grund, warum kein Marker gesetzt wurde */
  hinweis?: string;
}

export interface VerortungsOptionen {
  zeitzone?: string;
  /** Manueller Kameraversatz in ms (wird auf die Kamerazeit addiert) */
  versatzMs?: number;
  /** Manuelle Positionen je Dateiname */
  manuell?: Record<string, { km: number }>;
  zone?: Privatzone | null;
  /** Wie weit ein Foto zeitlich außerhalb der Aufzeichnung liegen darf */
  toleranzMs?: number;
}

/** „+00:03:20“ / „-2:00“ / „+90s“ → Millisekunden. */
export function versatzParsen(text: string | undefined | null): number {
  if (!text) return 0;
  const s = text.trim();
  const sek = s.match(/^([+-]?)(\d+)s$/);
  if (sek) return (sek[1] === '-' ? -1 : 1) * parseInt(sek[2], 10) * 1000;
  const m = s.match(/^([+-]?)(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`Ungültiger kamera_versatz „${text}“ – erwartet z. B. „+00:03:20“`);
  const [, vz, a, b, c] = m;
  const ms = c != null ? (+a * 3600 + +b * 60 + +c) * 1000 : (+a * 60 + +b) * 1000;
  return vz === '-' ? -ms : ms;
}

/** Offset einer Zeitzone (in ms) zu einem UTC-Zeitpunkt. */
function zonenOffsetMs(utc: number, zeitzone: string): number {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: zeitzone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utc));
  const w = (t: string) => parseInt(teile.find((p) => p.type === t)!.value, 10);
  const alsUtc = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour'), w('minute'), w('second'));
  return alsUtc - Math.floor(utc / 1000) * 1000;
}

/**
 * Wandelt eine EXIF-Lokalzeit in UTC um. Mit Offset wird dieser genommen,
 * sonst die Zeitzone (inkl. Sommer-/Winterzeit).
 */
export function exifZeitZuUtc(
  lokal: string,
  offset: string | null,
  zeitzone = 'Europe/Berlin',
): number | null {
  const m = lokal.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const naiv = Date.UTC(y, mo - 1, d, h, mi, s);
  const off = offset?.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (off) {
    const ms = (+off[2] * 60 + +off[3]) * 60000;
    return naiv - (off[1] === '-' ? -ms : ms);
  }
  // Zwei Iterationen genügen, um Umstellungstage korrekt zu treffen.
  let utc = naiv - zonenOffsetMs(naiv, zeitzone);
  utc = naiv - zonenOffsetMs(utc, zeitzone);
  return utc;
}

function naechsterPunkt(punkte: TrackPunkt[], ziel: LatLon): { punkt: TrackPunkt; abstand: number } | null {
  let best: TrackPunkt | null = null;
  let bestAbstand = Infinity;
  for (const p of punkte) {
    const d = abstandM(p, ziel);
    if (d < bestAbstand) {
      bestAbstand = d;
      best = p;
    }
  }
  return best ? { punkt: best, abstand: bestAbstand } : null;
}

/** Position zum Zeitpunkt t durch lineare Interpolation zwischen Trackpunkten. */
export function positionZurZeit(
  punkte: TrackPunkt[],
  t: number,
  toleranzMs = 10 * 60000,
): (LatLon & { km: number }) | null {
  const mitZeit = punkte.filter((p) => p.zeit != null);
  if (mitZeit.length < 2) return null;
  const erster = mitZeit[0];
  const letzter = mitZeit[mitZeit.length - 1];
  if (t < erster.zeit! - toleranzMs || t > letzter.zeit! + toleranzMs) return null;
  if (t <= erster.zeit!) return { lat: erster.lat, lon: erster.lon, km: erster.km };
  if (t >= letzter.zeit!) return { lat: letzter.lat, lon: letzter.lon, km: letzter.km };
  // Binärsuche nach dem Intervall [a, b] mit a.zeit <= t < b.zeit
  let lo = 0;
  let hi = mitZeit.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (mitZeit[mid].zeit! <= t) lo = mid;
    else hi = mid;
  }
  const a = mitZeit[lo];
  const b = mitZeit[hi];
  const f = b.zeit === a.zeit ? 0 : (t - a.zeit!) / (b.zeit! - a.zeit!);
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    km: a.km + (b.km - a.km) * f,
  };
}

const median = (werte: number[]) => {
  const s = [...werte].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Bestimmt je Gerät den Uhrversatz aus Fotos, die GPS und Zeit haben:
 * Trackzeit am nächstgelegenen Punkt minus Kamerazeit (Median).
 */
export function geraeteVersatz(
  fotos: FotoMeta[],
  punkte: TrackPunkt[],
  zeitzone = 'Europe/Berlin',
  maxAbstandM = 150,
): Map<string, number> {
  const proGeraet = new Map<string, number[]>();
  const mitZeit = punkte.filter((p) => p.zeit != null);
  if (mitZeit.length < 2) return new Map();
  for (const f of fotos) {
    if (!f.gps || !f.zeitLokal) continue;
    const kamera = exifZeitZuUtc(f.zeitLokal, f.zeitOffset, zeitzone);
    const n = naechsterPunkt(mitZeit, f.gps);
    if (kamera == null || !n || n.abstand > maxAbstandM) continue;
    const key = f.geraet ?? '?';
    proGeraet.set(key, [...(proGeraet.get(key) ?? []), n.punkt.zeit! - kamera]);
  }
  return new Map([...proGeraet].map(([g, w]) => [g, median(w)]));
}

/** Verortet alle Fotos einer Tour (manuell → GPS → Zeitstempel → keine Position). */
export function fotosVerorten(
  fotos: FotoMeta[],
  punkte: TrackPunkt[],
  opt: VerortungsOptionen = {},
): VerortetesFoto[] {
  const zeitzone = opt.zeitzone ?? 'Europe/Berlin';
  const autoVersatz = geraeteVersatz(fotos, punkte, zeitzone);

  const ergebnis = fotos.map((f): VerortetesFoto => {
    const kamera = f.zeitLokal ? exifZeitZuUtc(f.zeitLokal, f.zeitOffset, zeitzone) : null;
    const versatz = autoVersatz.get(f.geraet ?? '?') ?? opt.versatzMs ?? 0;
    const zeit = kamera != null ? kamera + versatz : null;

    let position: VerortetesFoto['position'] = null;
    let quelle: Quelle | null = null;
    let hinweis: string | undefined;

    const manuell = opt.manuell?.[f.datei];
    if (manuell) {
      position = positionBeiKm(punkte, manuell.km);
      quelle = 'manuell';
      if (!position) hinweis = `km ${manuell.km} liegt außerhalb des Tracks`;
    } else if (f.gps) {
      const n = naechsterPunkt(punkte, f.gps);
      if (n) position = { lat: n.punkt.lat, lon: n.punkt.lon, km: n.punkt.km };
      quelle = 'gps';
    } else if (zeit != null) {
      position = positionZurZeit(punkte, zeit, opt.toleranzMs);
      quelle = 'zeit';
      if (!position) {
        hinweis = punkte.some((p) => p.zeit != null)
          ? 'Aufnahmezeit liegt außerhalb der Aufzeichnung (Kamerauhr/Zeitzone prüfen)'
          : 'GPX enthält keine Zeitstempel (aufgezeichnete Tour exportieren)';
      }
    } else {
      hinweis = 'weder GPS noch Aufnahmezeit vorhanden';
    }

    if (position && inZone(position, opt.zone)) {
      position = null;
      hinweis = 'liegt in der Privatzone';
    }
    if (!position) quelle = null;
    return { datei: f.datei, position, quelle, zeit, hinweis };
  });

  // Nach korrigierter Zeit sortieren; Fotos ohne Zeit nach Streckenkilometer bzw. Dateiname.
  const vergleich = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
  return ergebnis.sort(
    (a, b) =>
      vergleich(a.zeit ?? Infinity, b.zeit ?? Infinity) ||
      vergleich(a.position?.km ?? Infinity, b.position?.km ?? Infinity) ||
      a.datei.localeCompare(b.datei, 'de', { numeric: true }),
  );
}

export function positionBeiKm(punkte: TrackPunkt[], km: number): (LatLon & { km: number }) | null {
  if (punkte.length === 0) return null;
  const start = punkte[0].km;
  const ende = punkte[punkte.length - 1].km;
  if (km < start || km > ende) return null;
  for (let i = 1; i < punkte.length; i++) {
    const a = punkte[i - 1];
    const b = punkte[i];
    if (b.km >= km) {
      const f = b.km === a.km ? 0 : (km - a.km) / (b.km - a.km);
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, km };
    }
  }
  return { lat: punkte[0].lat, lon: punkte[0].lon, km: start };
}
