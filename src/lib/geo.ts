export interface LatLon {
  lat: number;
  lon: number;
}

export interface Privatzone extends LatLon {
  radiusM: number;
}

const ERDRADIUS_M = 6371008.8;
const rad = (g: number) => (g * Math.PI) / 180;

/** Entfernung zweier Punkte in Metern (Haversine). */
export function abstandM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * ERDRADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function inZone(p: LatLon, zone: Privatzone | null | undefined): boolean {
  return !!zone && abstandM(p, zone) <= zone.radiusM;
}

/** Liest die Privatzone aus Umgebungsvariablen; null, wenn nicht gesetzt. */
export function privatzoneAusEnv(env: Record<string, string | undefined>): Privatzone | null {
  const lat = parseFloat(env.PRIVACY_LAT ?? '');
  const lon = parseFloat(env.PRIVACY_LON ?? '');
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const radius = parseFloat(env.PRIVACY_RADIUS_M ?? '');
  return { lat, lon, radiusM: Number.isFinite(radius) && radius > 0 ? radius : 500 };
}
