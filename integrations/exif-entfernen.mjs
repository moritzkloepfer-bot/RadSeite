import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const FORMATE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

async function* bilder(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* bilder(p);
    else if (FORMATE.has(path.extname(e.name).toLowerCase())) yield p;
  }
}

/**
 * Astro legt neben den optimierten Bildern auch die Originale in dist/_astro ab.
 * Diese Integration entfernt nach dem Build aus allen Bildern EXIF/XMP
 * (u. a. GPS-Position und Aufnahmezeit), damit nichts davon veröffentlicht wird.
 */
export default function exifEntfernen() {
  return {
    name: 'radseite:exif-entfernen',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        let bereinigt = 0;
        for await (const datei of bilder(fileURLToPath(dir))) {
          const buf = await readFile(datei);
          const meta = await sharp(buf).metadata();
          if (!meta.exif && !meta.xmp && !meta.iptc) continue;
          const bild = sharp(buf).autoOrient();
          const ext = path.extname(datei).toLowerCase();
          const aus =
            ext === '.png'
              ? bild.png()
              : ext === '.webp'
                ? bild.webp({ quality: 88 })
                : ext === '.avif'
                  ? bild.avif({ quality: 70 })
                  : bild.jpeg({ quality: 88, mozjpeg: true });
          await writeFile(datei, await aus.toBuffer()); // sharp schreibt ohne .keepExif() keine Metadaten
          bereinigt++;
        }
        logger.info(`Metadaten aus ${bereinigt} Bild(ern) entfernt`);
      },
    },
  };
}
