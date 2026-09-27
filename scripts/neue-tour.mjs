#!/usr/bin/env node
/**
 * Legt eine neue Tour an.
 *
 *   npm run neue-tour -- <datei.gpx> "Titel der Tour" [--fotos <ordner>]
 *
 * - kopiert die GPX nach src/content/touren/<slug>/track.gpx
 * - erkennt anhand der Zeitstempel, ob die Tour gefahren oder geplant ist
 * - verkleinert optional Fotos auf max. 2400 px (EXIF bleibt für die Verortung erhalten,
 *   außer der GPS-Position bei Fotos, die in der Privatzone aufgenommen wurden)
 * - schreibt eine index.md-Vorlage
 *
 * Fotos einer bestehenden Tour hinzufügen:
 *   npm run neue-tour -- --fotos <ordner> --tour <slug>
 */
import { copyFile, mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import exifr from 'exifr';
import sharp from 'sharp';

const MAX_KANTE = 2400;
const BILDFORMATE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const TOUREN = path.resolve('src/content/touren');

function argumente(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const existiert = (p) => access(p).then(() => true, () => false);

/** Privatzone aus .env bzw. Umgebungsvariablen – wie beim Build. */
function privatzone() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // keine .env vorhanden
  }
  const lat = parseFloat(process.env.PRIVACY_LAT ?? '');
  const lon = parseFloat(process.env.PRIVACY_LON ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, radiusM: parseFloat(process.env.PRIVACY_RADIUS_M ?? '') || 500 };
}

const rad = (g) => (g * Math.PI) / 180;
function abstandM(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Die Originalfotos liegen im (öffentlichen) Repo. Liegt die GPS-Position in der
 * Privatzone, werden nur Kamera und Aufnahmezeit übernommen, damit das Foto
 * weiterhin zeitlich einsortiert werden kann, ohne den Ort zu verraten.
 */
async function exifOhneGps(datei) {
  const roh = await exifr
    .parse(datei, {
      reviveValues: false,
      pick: ['Make', 'Model', 'DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal'],
    })
    .catch(() => undefined);
  const nurText = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string'));
  return {
    IFD0: nurText({ Make: roh?.Make, Model: roh?.Model }),
    IFD2: nurText({
      DateTimeOriginal: roh?.DateTimeOriginal ?? roh?.CreateDate,
      OffsetTimeOriginal: roh?.OffsetTimeOriginal,
    }),
  };
}

async function fotosImportieren(quelle, ziel) {
  await mkdir(ziel, { recursive: true });
  const dateien = (await readdir(quelle)).filter((d) => BILDFORMATE.has(path.extname(d).toLowerCase()));
  const uebersprungen = (await readdir(quelle)).filter((d) => /\.(heic|heif)$/i.test(d));
  const zone = privatzone();
  if (!zone) {
    console.warn('  ⚠ Keine Privatzone in .env – GPS-Daten aller Fotos bleiben im Repo erhalten.');
  }
  let bereinigt = 0;
  for (const d of dateien) {
    const eingabe = path.join(quelle, d);
    const aus = path.join(ziel, d.replace(/\.jpeg$/i, '.jpg'));
    const gps = await exifr.gps(eingabe).catch(() => undefined);
    const inZone =
      !!zone && gps?.latitude != null && abstandM({ lat: gps.latitude, lon: gps.longitude }, zone) <= zone.radiusM;

    let bild = sharp(eingabe)
      .autoOrient()
      .resize({ width: MAX_KANTE, height: MAX_KANTE, fit: 'inside', withoutEnlargement: true });
    // Sonst bleiben GPS und Aufnahmezeit für die Verortung erhalten; die Website liefert Bilder ohne EXIF aus.
    bild = inZone ? bild.withExif(await exifOhneGps(eingabe)) : bild.keepExif();
    await bild.jpeg({ quality: 85, mozjpeg: true }).toFile(aus.replace(/\.(png|webp)$/i, '.jpg'));
    if (inZone) bereinigt++;
    console.log(`  ✓ ${d}${inZone ? ' (in der Privatzone aufgenommen – GPS entfernt)' : ''}`);
  }
  if (bereinigt) console.log(`  ${bereinigt} Foto(s) ohne GPS gespeichert.`);
  if (uebersprungen.length) {
    console.warn(
      `  ⚠ ${uebersprungen.length} HEIC-Datei(en) übersprungen. Bitte als JPG exportieren ` +
        '(iPhone: Einstellungen → Kamera → Formate → „Maximale Kompatibilität“).',
    );
  }
  return dateien.length;
}

function berlinDatum(iso) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin' }).format(new Date(iso));
}

async function main() {
  const { pos, opt } = argumente(process.argv.slice(2));

  if (opt.tour && opt.fotos) {
    const ziel = path.join(TOUREN, opt.tour, 'fotos');
    if (!(await existiert(path.join(TOUREN, opt.tour)))) throw new Error(`Tour „${opt.tour}“ gibt es nicht.`);
    const n = await fotosImportieren(opt.fotos, ziel);
    console.log(`${n} Foto(s) zu ${opt.tour} hinzugefügt.`);
    return;
  }

  const [gpxPfad, titelArg] = pos;
  if (!gpxPfad) {
    console.log('Aufruf: npm run neue-tour -- <datei.gpx> "Titel" [--fotos <ordner>]');
    process.exit(1);
  }
  const gpx = await readFile(gpxPfad, 'utf-8');
  const gpxName = gpx.match(/<name>([^<]+)<\/name>/)?.[1]?.trim();
  const titel = titelArg || gpxName || path.basename(gpxPfad, '.gpx');
  const slug = opt.slug || slugify(titel);
  const ordner = path.join(TOUREN, slug);
  if (await existiert(ordner)) throw new Error(`Ordner existiert bereits: ${ordner}`);

  const ersteZeit = gpx.match(/<trkpt[^>]*>[\s\S]*?<time>([^<]+)<\/time>/)?.[1];
  const gefahren = !!ersteZeit;
  // Komoot benennt Exporte „<datum>_<tour-id>_<name>.gpx“
  const komootId = path.basename(gpxPfad).match(/^\d{4}-\d{2}-\d{2}_(\d+)_/)?.[1];
  const komoot =
    gpx.match(/https?:\/\/www\.komoot\.[a-z]+\/[^"<\s]*tour\/\d+/)?.[0] ??
    (komootId ? `https://www.komoot.com/de-de/tour/${komootId}` : undefined);

  await mkdir(ordner, { recursive: true });
  await copyFile(gpxPfad, path.join(ordner, 'track.gpx'));
  let fotos = 0;
  if (opt.fotos) fotos = await fotosImportieren(opt.fotos, path.join(ordner, 'fotos'));

  const md = `---
titel: ${JSON.stringify(titel)}
status: ${gefahren ? 'gefahren' : 'geplant'}
${gefahren ? `datum: ${berlinDatum(ersteZeit)}` : '# datum: 2026-01-31   # beim Umstellen auf „gefahren“ eintragen'}
${komoot ? `komoot: ${komoot}` : '# komoot: https://www.komoot.com/de-de/tour/…'}
# region: Schwarzwald
bewertung:
  anspruch: 3     # 1 = locker … 5 = sehr anstrengend
  schoenheit: 3   # 1 = naja … 5 = außergewöhnlich schön
${gefahren ? '  ruhe: 3' : '  # ruhe: 3'}         # 1 = viel Verkehr … 5 = sehr einsam
tags: []
belag: []         # z. B. [asphalt, schotter, trail]
# titelbild: IMG_1234.jpg
# kamera_versatz: "+00:00:00"   # nur nötig, wenn die Kamerauhr falsch ging und kein Foto GPS hat
# fotos:
#   IMG_1234.jpg: { km: 12.5 }  # Foto manuell auf Streckenkilometer setzen
---

Beschreibung der Tour …
`;
  await writeFile(path.join(ordner, 'index.md'), md);

  console.log(`\nNeue Tour angelegt: src/content/touren/${slug}/`);
  console.log(`  Status: ${gefahren ? 'gefahren (Zeitstempel gefunden)' : 'geplant (keine Zeitstempel)'}`);
  if (fotos) console.log(`  Fotos: ${fotos}`);
  console.log('  → Bewertung und Text in index.md eintragen, dann „npm run dev“ zum Ansehen.');
}

main().catch((e) => {
  console.error(`Fehler: ${e.message}`);
  process.exit(1);
});
