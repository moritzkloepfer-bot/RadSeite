# RadSeite

Eine statische Website für geplante und gefahrene Radtouren, gebaut mit Astro. Grundlage sind die GPX-Exporte aus Komoot, dazu Fotos und eine Bewertung auf drei Skalen.

| Skala | 1 | 5 |
|---|---|---|
| **Anspruch** (konditionell) | locker | sehr anstrengend |
| **Schönheit** | naja | außergewöhnlich |
| **Ruhe** (Verkehr/Einsamkeit) | viel Verkehr | sehr einsam |

## Loslegen

```bash
npm install
cp .env.example .env      # Privatzone eintragen (siehe unten)
npm run dev               # http://localhost:4321
```

## Neue Tour anlegen

1. **Exportieren:** In Komoot die Tour öffnen, dann „…“ → „GPX-Datei herunterladen“. Für gefahrene Touren die **aufgezeichnete** Tour exportieren, nicht die Planung. Nur sie enthält Zeitstempel, und die braucht die Seite, um Fotos ohne GPS zu verorten.
2. **Anlegen:**
   ```bash
   npm run neue-tour -- ~/Downloads/tour.gpx "Rund um den Kaiserstuhl" --fotos ~/Bilder/kaiserstuhl
   ```
   Das Skript legt `src/content/touren/<slug>/` mit `track.gpx`, `index.md` und `fotos/` an. Die Fotos werden auf max. 2400 px verkleinert, die EXIF-Daten bleiben dabei erhalten.
3. **Ausfüllen:** Sterne, Tags und Text in `index.md` eintragen.
4. **Veröffentlichen:** Mit `git push` baut GitHub Actions die Seite und veröffentlicht sie.

Fotos später hinzufügen: `npm run neue-tour -- --tour <slug> --fotos <ordner>`

**Von geplant zu gefahren:** In `index.md` `status: gefahren` und das `datum` setzen. `track.gpx` durch die aufgezeichnete Tour ersetzen, dann Fotos hinzufügen.

## Frontmatter

```yaml
titel: "Rund um den Kaiserstuhl"
status: gefahren            # geplant | gefahren
datum: 2026-08-14           # Pflicht bei „gefahren“
komoot: https://www.komoot.com/de-de/tour/123
region: Kaiserstuhl
bewertung: { anspruch: 3, schoenheit: 5, ruhe: 4 }   # einzelne Werte dürfen fehlen
tags: [weinberge, rundtour]
belag: [asphalt, schotter]
titelbild: aussicht.jpg     # sonst das erste Foto
kamera_versatz: "+00:03:20" # optional, s. u.
fotos:                      # optional: Foto manuell auf Streckenkilometer setzen
  IMG_1234.jpg: { km: 12.5 }
```

Diese Werte berechnet die Seite selbst aus der GPX-Datei:
- Distanz
- Höhenmeter bergauf und bergab
- Höchster Punkt
- Max. Steigung
- Dauer bzw. geschätzte Fahrzeit

## Wie Fotos auf die Karte kommen

Die Seite probiert diese Stufen der Reihe nach:

1. **Manuell:** Ein Eintrag unter `fotos:` im Frontmatter hat Vorrang.
2. **GPS:** Das Foto kommt auf den nächstgelegenen Punkt des Tracks.
3. **Zeitstempel:** Die Aufnahmezeit wird mit den Zeitstempeln der GPX-Datei abgeglichen und die Position dazwischen interpoliert.
   - Enthält das Foto keine Zeitzone, gilt `Europe/Berlin` (inkl. Sommerzeit).
   - Geht die Kamerauhr falsch und ein anderes Foto **desselben Geräts** hat GPS, wird der Versatz automatisch herausgerechnet. Andernfalls `kamera_versatz` setzen (Wert wird auf die Kamerazeit addiert).
4. **Sonst:** Das Foto erscheint nur in der Galerie. Beim Build gibt es dazu einen Hinweis.

iPhone-Fotos im HEIC-Format werden nicht unterstützt. Bitte als JPG exportieren.

## Privatsphäre

- **Privatzone:** Trackpunkte im Radius um `PRIVACY_LAT/PRIVACY_LON` werden nicht veröffentlicht, Standard sind 500 m. Das gilt für Karte, Höhenprofil und GPX-Download. Die Koordinaten stehen nur in `.env` bzw. in den GitHub-Secrets, nie im Repo.
- **Kennzahlen:** Distanz, Höhenmeter usw. werden weiterhin aus dem vollständigen Track berechnet.
- **GPX-Download:** Die Datei enthält keine Zeitstempel.
- **Fotos:** Alle ausgelieferten Bilder werden nach dem Build ohne EXIF-Daten neu geschrieben (`integrations/exif-entfernen.mjs`). Fotos, die in der Privatzone aufgenommen wurden, bekommen keinen Kartenmarker.
- **Kontrolle:** `npm run build && npm run check-privacy` prüft die fertige Seite. Der Deploy-Workflow führt diese Prüfung automatisch aus und bricht bei einem Verstoß ab.

## Veröffentlichen (GitHub Pages)

1. Ein Repository auf GitHub anlegen und das Projekt pushen.
2. Unter *Settings → Pages → Source* „GitHub Actions“ wählen.
3. Unter *Settings → Secrets and variables → Actions* diese Secrets anlegen:
   - `PRIVACY_LAT`
   - `PRIVACY_LON`
   - optional `PRIVACY_RADIUS_M`

Jeder Push auf `main` löst dann Tests, Build, Privatsphäre-Prüfung und Veröffentlichung aus.

**Vor der Veröffentlichung:** `src/pages/impressum.astro` ausfüllen und die Beispieltouren in `src/content/touren/beispiel-*` löschen.

## Befehle

| Befehl | Zweck |
|---|---|
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Seite nach `dist/` bauen |
| `npm test` | Unit-Tests (GPX, Privatzone, Foto-Verortung) |
| `npm run check-privacy` | Gebaute Seite auf Privatzone/GPS prüfen |
| `npm run neue-tour` | Neue Tour anlegen / Fotos importieren |
