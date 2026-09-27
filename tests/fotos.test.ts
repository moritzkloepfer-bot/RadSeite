import { describe, expect, it } from 'vitest';
import { exifZeitZuUtc, fotosVerorten, positionZurZeit, versatzParsen, type FotoMeta } from '../src/lib/fotos';
import { parseGpx } from '../src/lib/gpx';

const START = Date.UTC(2026, 7, 14, 7, 0, 0); // 09:00 Uhr MESZ

/** 10 km nach Norden, alle 100 m ein Punkt, 18 s pro Punkt (20 km/h). */
function track() {
  const pts = Array.from({ length: 101 }, (_, i) => {
    const lat = 48 + (i * 0.1) / 111.195;
    return `<trkpt lat="${lat}" lon="7.8"><ele>200</ele><time>${new Date(START + i * 18000).toISOString()}</time></trkpt>`;
  });
  return parseGpx(`<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`).punkte;
}

const foto = (f: Partial<FotoMeta>): FotoMeta => ({
  datei: 'a.jpg',
  gps: null,
  zeitLokal: null,
  zeitOffset: null,
  geraet: 'Handy',
  ...f,
});

describe('exifZeitZuUtc', () => {
  it('berücksichtigt Sommerzeit in Europe/Berlin', () => {
    expect(exifZeitZuUtc('2026:08:14 09:00:00', null)).toBe(START);
  });
  it('berücksichtigt Winterzeit in Europe/Berlin', () => {
    expect(exifZeitZuUtc('2026:01:10 09:00:00', null)).toBe(Date.UTC(2026, 0, 10, 8, 0, 0));
  });
  it('bevorzugt OffsetTimeOriginal', () => {
    expect(exifZeitZuUtc('2026:08:14 09:00:00', '+05:30')).toBe(Date.UTC(2026, 7, 14, 3, 30, 0));
  });
  it('liefert null bei unlesbarem Format', () => {
    expect(exifZeitZuUtc('gestern', null)).toBeNull();
  });
});

describe('versatzParsen', () => {
  it('versteht h:mm:ss, mm:ss und Sekunden', () => {
    expect(versatzParsen('+00:03:20')).toBe(200000);
    expect(versatzParsen('-2:00')).toBe(-120000);
    expect(versatzParsen('90s')).toBe(90000);
    expect(versatzParsen(undefined)).toBe(0);
    expect(() => versatzParsen('bald')).toThrow();
  });
});

describe('positionZurZeit', () => {
  it('interpoliert zwischen zwei Trackpunkten', () => {
    const punkte = track();
    const p = positionZurZeit(punkte, START + 50 * 18000 + 9000)!; // Mitte zwischen Punkt 50 und 51
    expect(p.km).toBeCloseTo(5.05, 2);
    expect(p.lat).toBeCloseTo((punkte[50].lat + punkte[51].lat) / 2, 6);
  });
  it('liefert null weit außerhalb der Aufzeichnung', () => {
    expect(positionZurZeit(track(), START - 3600_000)).toBeNull();
  });
});

describe('fotosVerorten', () => {
  it('verortet per Zeitstempel (Lokalzeit ohne Zone)', () => {
    const [f] = fotosVerorten([foto({ zeitLokal: '2026:08:14 09:15:00' })], track());
    expect(f.quelle).toBe('zeit');
    expect(f.position!.km).toBeCloseTo(5, 1); // 15 min bei 20 km/h
  });

  it('berechnet den Kameraversatz automatisch aus einem GPS-Foto desselben Geräts', () => {
    const punkte = track();
    // Kamera geht 5 Minuten vor: GPS-Foto bei km 2 zeigt 09:11 statt 09:06.
    const mitGps = foto({ datei: 'gps.jpg', geraet: 'Kamera', gps: { lat: punkte[20].lat, lon: 7.8 }, zeitLokal: '2026:08:14 09:11:00' });
    const ohneGps = foto({ datei: 'zeit.jpg', geraet: 'Kamera', zeitLokal: '2026:08:14 09:35:00' });
    const res = fotosVerorten([ohneGps, mitGps], punkte);
    const z = res.find((r) => r.datei === 'zeit.jpg')!;
    expect(z.quelle).toBe('zeit');
    expect(z.position!.km).toBeCloseTo(10, 1); // echte Zeit 09:30 → km 10
    expect(res[0].datei).toBe('gps.jpg'); // Sortierung nach korrigierter Zeit
  });

  it('nutzt den manuellen Versatz, wenn kein GPS-Foto vorhanden ist', () => {
    const [f] = fotosVerorten([foto({ zeitLokal: '2026:08:14 09:20:00' })], track(), { versatzMs: -5 * 60000 });
    expect(f.position!.km).toBeCloseTo(5, 1);
  });

  it('manuelle km-Angabe hat Vorrang', () => {
    const [f] = fotosVerorten([foto({ zeitLokal: '2026:08:14 09:15:00' })], track(), { manuell: { 'a.jpg': { km: 2 } } });
    expect(f.quelle).toBe('manuell');
    expect(f.position!.km).toBe(2);
  });

  it('setzt keinen Marker ohne verwertbare Daten', () => {
    const [f] = fotosVerorten([foto({})], track());
    expect(f.position).toBeNull();
    expect(f.hinweis).toMatch(/weder GPS/);
  });

  it('setzt keinen Marker bei Zeit außerhalb der Aufzeichnung', () => {
    const [f] = fotosVerorten([foto({ zeitLokal: '2026:08:14 18:00:00' })], track());
    expect(f.position).toBeNull();
    expect(f.hinweis).toMatch(/außerhalb/);
  });

  it('setzt keinen Marker in der Privatzone', () => {
    const punkte = track();
    const [f] = fotosVerorten([foto({ gps: { lat: punkte[1].lat, lon: 7.8 } })], punkte, {
      zone: { lat: punkte[0].lat, lon: 7.8, radiusM: 500 },
    });
    expect(f.position).toBeNull();
    expect(f.hinweis).toMatch(/Privatzone/);
  });
});
