#!/usr/bin/env node
/**
 * Legt eine neue Tour an.
 *
 *   npm run neue-tour -- <datei.gpx> "Titel der Tour" [--fotos <ordner>]
 *
 * - kopiert die GPX nach src/content/touren/<slug>/track.gpx
 * - erkennt anhand der Zeitstempel, ob die Tour gefahren oder geplant ist
 * - verkleinert optional Fotos auf max. 2400 px (EXIF bleibt für die Verortung erhalten)
 * - schreibt eine index.md-Vorlage
 *
 * Fotos einer bestehenden Tour hinzufügen:
 *   npm run neue-tour -- --fotos <ordner> --tour <slug>
 */
import { copyFile, mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
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

async function fotosImportieren(quelle, ziel) {
  await mkdir(ziel, { recursive: true });
  const dateien = (await readdir(quelle)).filter((d) => BILDFORMATE.has(path.extname(d).toLowerCase()));
  const uebersprungen = (await readdir(quelle)).filter((d) => /\.(heic|heif)$/i.test(d));
  for (const d of dateien) {
    const aus = path.join(ziel, d.replace(/\.jpeg$/i, '.jpg'));
    await sharp(path.join(quelle, d))
      .autoOrient()
      .resize({ width: MAX_KANTE, height: MAX_KANTE, fit: 'inside', withoutEnlargement: true })
      .keepExif() // GPS und Aufnahmezeit werden beim Build gebraucht; die Website liefert Bilder ohne EXIF aus
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(aus.replace(/\.(png|webp)$/i, '.jpg'));
    console.log(`  ✓ ${d}`);
  }
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
  const komoot = gpx.match(/https?:\/\/www\.komoot\.[a-z]+\/[^"<\s]*tour\/\d+/)?.[0];

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
