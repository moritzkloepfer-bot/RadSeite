import { describe, expect, it } from 'vitest';
import { abstandM } from '../src/lib/geo';
import { alsGpx, kennzahlen, parseGpx, privatzoneKuerzen, profil, vereinfachen } from '../src/lib/gpx';

/** Gerade Strecke nach Norden: n Punkte im Abstand von ~100 m, Anstieg von 10 m je Punkt. */
function testGpx(n = 101, mitZeit = true): string {
  const pts = Array.from({ length: n }, (_, i) => {
    const lat = 48 + (i * 0.1) / 111.195; // ~100 m je Schritt
    const zeit = new Date(Date.UTC(2026, 7, 14, 7, 0, 0) + i * 18000).toISOString(); // 20 km/h
    return `<trkpt lat="${lat}" lon="7.8"><ele>${200 + i * 10}</ele>${mitZeit ? `<time>${zeit}</time>` : ''}</trkpt>`;
  });
  return `<?xml version="1.0"?><gpx><trk><name>Test</name><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}

describe('parseGpx', () => {
  it('liest Punkte, Höhe, Zeit und kumulierte Strecke', () => {
    const t = parseGpx(testGpx());
    expect(t.name).toBe('Test');
    expect(t.punkte).toHaveLength(101);
    expect(t.punkte[0].ele).toBe(200);
    expect(t.punkte[0].zeit).toBe(Date.UTC(2026, 7, 14, 7, 0, 0));
    expect(t.punkte[100].km).toBeCloseTo(10, 1);
  });

  it('fällt auf Routenpunkte zurück', () => {
    const xml = '<gpx><rte><rtept lat="48" lon="7"/><rtept lat="48.01" lon="7"/></rte></gpx>';
    const t = parseGpx(xml);
    expect(t.punkte).toHaveLength(2);
    expect(t.punkte[1].zeit).toBeNull();
  });
});

describe('kennzahlen', () => {
  it('berechnet Distanz, Höhenmeter und Steigung im Rahmen von ±2 %', () => {
    const k = kennzahlen(parseGpx(testGpx()).punkte);
    expect(k.distanzKm).toBeGreaterThan(9.8);
    expect(k.distanzKm).toBeLessThan(10.2);
    expect(k.aufstiegM).toBe(1000);
    expect(k.abstiegM).toBe(0);
    expect(k.maxSteigungProzent).toBeCloseTo(10, 0);
    expect(k.dauerMin).toBe(30);
    expect(k.hatZeitstempel).toBe(true);
  });

  it('ignoriert GPS-Rauschen unter der Schwelle', () => {
    const pts = Array.from({ length: 50 }, (_, i) => `<trkpt lat="${48 + i * 0.001}" lon="7"><ele>${300 + (i % 2) * 2}</ele></trkpt>`);
    const k = kennzahlen(parseGpx(`<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`).punkte);
    expect(k.aufstiegM).toBe(0);
  });
});

describe('Privatzone', () => {
  it('entfernt Punkte im Radius und behält die Original-km', () => {
    const punkte = parseGpx(testGpx()).punkte;
    const zone = { lat: punkte[0].lat, lon: 7.8, radiusM: 500 };
    const gekuerzt = privatzoneKuerzen(punkte, zone);
    expect(gekuerzt.every((p) => abstandM(p, zone) > 500)).toBe(true);
    expect(gekuerzt[0].km).toBeGreaterThan(0.5);
    expect(gekuerzt[gekuerzt.length - 1].km).toBeCloseTo(10, 1);
    // Rundtour: Start- und Zielbereich werden entfernt
    const ziel = { lat: punkte[100].lat, lon: 7.8, radiusM: 300 };
    expect(privatzoneKuerzen(punkte, ziel).at(-1)!.km).toBeLessThan(9.8);
  });

  it('lässt ohne Zone alles unverändert', () => {
    const punkte = parseGpx(testGpx()).punkte;
    expect(privatzoneKuerzen(punkte, null)).toBe(punkte);
  });

  it('der GPX-Export enthält keine Zeitstempel', () => {
    const gpx = alsGpx('A & B', parseGpx(testGpx(5)).punkte);
    expect(gpx).not.toContain('<time>');
    expect(gpx).toContain('A &amp; B');
    expect(parseGpx(gpx).punkte).toHaveLength(5);
  });
});

describe('vereinfachen und profil', () => {
  it('dünnt eine Gerade auf Start und Ende aus', () => {
    const punkte = parseGpx(testGpx()).punkte;
    const v = vereinfachen(punkte);
    expect(v[0]).toBe(punkte[0]);
    expect(v.at(-1)).toBe(punkte.at(-1));
    expect(v.length).toBeLessThan(5);
  });

  it('tastet das Profil gleichmäßig ab', () => {
    const p = profil(parseGpx(testGpx()).punkte, 11);
    expect(p).toHaveLength(11);
    expect(p[5].ele).toBeCloseTo(700, -1);
    expect(p[10].ele).toBe(1200);
  });
});
