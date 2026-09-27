import { readFile } from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import type { ImageMetadata } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { privatzoneAusEnv } from './geo';
import {
  kennzahlen,
  parseGpx,
  privatzoneKuerzen,
  profil,
  vereinfachen,
  type Kennzahlen,
  type ProfilPunkt,
  type TrackPunkt,
} from './gpx';
import { fotosVerorten, versatzParsen, type FotoMeta, type VerortetesFoto } from './fotos';

export interface Foto extends VerortetesFoto {
  bild: ImageMetadata;
}

export interface Tour {
  id: string;
  eintrag: CollectionEntry<'touren'>;
  daten: CollectionEntry<'touren'>['data'];
  kennzahlen: Kennzahlen;
  /** Veröffentlichte Punkte (Privatzone entfernt) */
  punkte: TrackPunkt[];
  /** Vereinfachte Linie für Karten als [lat, lon] */
  linie: [number, number][];
  profil: ProfilPunkt[];
  fotos: Foto[];
  titelbild: Foto | null;
}

const bilder = import.meta.glob<ImageMetadata>(
  '/src/content/touren/*/fotos/*.{jpg,jpeg,JPG,JPEG,png,PNG,webp,WEBP}',
  { eager: true, import: 'default' },
);

const zone = privatzoneAusEnv({
  PRIVACY_LAT: import.meta.env.PRIVACY_LAT ?? process.env.PRIVACY_LAT,
  PRIVACY_LON: import.meta.env.PRIVACY_LON ?? process.env.PRIVACY_LON,
  PRIVACY_RADIUS_M: import.meta.env.PRIVACY_RADIUS_M ?? process.env.PRIVACY_RADIUS_M,
});
if (!zone) {
  console.warn('[RadSeite] Keine Privatzone gesetzt (PRIVACY_LAT/PRIVACY_LON) – Tracks werden ungekürzt veröffentlicht.');
}

async function exifLesen(datei: string, absolut: string): Promise<FotoMeta> {
  const [gps, roh] = await Promise.all([
    exifr.gps(absolut).catch(() => undefined),
    exifr
      .parse(absolut, {
        reviveValues: false,
        pick: ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'Make', 'Model'],
      })
      .catch(() => undefined),
  ]);
  const zeit = roh?.DateTimeOriginal ?? roh?.CreateDate ?? null;
  const geraet = [roh?.Make, roh?.Model].filter(Boolean).join(' ').trim() || null;
  return {
    datei,
    gps:
      gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)
        ? { lat: gps.latitude, lon: gps.longitude }
        : null,
    zeitLokal: typeof zeit === 'string' ? zeit : null,
    zeitOffset: typeof roh?.OffsetTimeOriginal === 'string' ? roh.OffsetTimeOriginal : null,
    geraet,
  };
}

async function tourLaden(eintrag: CollectionEntry<'touren'>): Promise<Tour> {
  const ordner = path.join(process.cwd(), 'src/content/touren', eintrag.id);
  const gpxText = await readFile(path.join(ordner, 'track.gpx'), 'utf-8').catch(() => {
    throw new Error(`[RadSeite] Tour „${eintrag.id}“: track.gpx fehlt in ${ordner}`);
  });
  const track = parseGpx(gpxText);
  const alle = track.punkte;
  const oeffentlich = privatzoneKuerzen(alle, zone);

  const praefix = `/src/content/touren/${eintrag.id}/fotos/`;
  const dateien = Object.keys(bilder).filter((k) => k.startsWith(praefix));
  const metas = await Promise.all(
    dateien.map((k) => exifLesen(k.slice(praefix.length), path.join(process.cwd(), k))),
  );
  const verortet = fotosVerorten(metas, alle, {
    versatzMs: versatzParsen(eintrag.data.kamera_versatz),
    manuell: eintrag.data.fotos,
    zone,
  });
  for (const f of verortet) {
    if (!f.position && f.hinweis) {
      console.warn(`[RadSeite] ${eintrag.id}/${f.datei}: kein Kartenmarker – ${f.hinweis}`);
    }
  }
  const fotos: Foto[] = verortet.map((f) => ({ ...f, bild: bilder[praefix + f.datei] }));
  const titelbild =
    fotos.find((f) => f.datei === eintrag.data.titelbild) ?? fotos[0] ?? null;

  return {
    id: eintrag.id,
    eintrag,
    daten: eintrag.data,
    kennzahlen: kennzahlen(alle),
    punkte: oeffentlich,
    linie: vereinfachen(oeffentlich).map((p) => [+p.lat.toFixed(5), +p.lon.toFixed(5)]),
    profil: profil(oeffentlich).map((p) => ({
      km: +p.km.toFixed(3),
      ele: Math.round(p.ele),
      lat: +p.lat.toFixed(5),
      lon: +p.lon.toFixed(5),
    })),
    fotos,
    titelbild,
  };
}

let cache: Promise<Tour[]> | null = null;

/** Alle Touren: gefahrene nach Datum (neueste zuerst), dann geplante nach Titel. */
export function alleTouren(): Promise<Tour[]> {
  // Im Dev-Server nicht cachen, damit neue oder geänderte Touren sofort erscheinen
  if (import.meta.env.DEV) cache = null;
  cache ??= getCollection('touren')
    .then((e) => Promise.all(e.map(tourLaden)))
    .then((t) =>
      t.sort((a, b) => {
        if (a.daten.status !== b.daten.status) return a.daten.status === 'gefahren' ? -1 : 1;
        const d = (b.daten.datum?.getTime() ?? 0) - (a.daten.datum?.getTime() ?? 0);
        return d || a.daten.titel.localeCompare(b.daten.titel, 'de');
      }),
    );
  return cache;
}

export const url = (pfad: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${pfad.replace(/^\//, '')}`;

export const fmtKm = (km: number) => km.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
export const fmtDauer = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
export const fmtDatum = (d: Date) =>
  d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });
