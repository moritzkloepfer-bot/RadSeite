import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-Mitwirkende';

export function basisKarte(el: HTMLElement): L.Map {
  const karte = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25 }).setView([51.1, 10.4], 6);
  const ebenen = {
    Standard: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: OSM_ATTR,
    }),
    CyclOSM: L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: `${OSM_ATTR}, Stil <a href="https://www.cyclosm.org">CyclOSM</a>`,
    }),
    Topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: `${OSM_ATTR}, SRTM | Stil © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
    }),
  };
  ebenen.Standard.addTo(karte);
  L.control.layers(ebenen, undefined, { position: 'topright' }).addTo(karte);
  L.control.scale({ imperial: false }).addTo(karte);
  // Scrollzoom erst nach Klick in die Karte, damit die Seite normal scrollt
  karte.once('focus click', () => karte.scrollWheelZoom.enable());
  return karte;
}

/**
 * Passt die Karte an die Grenzen an – auch dann, wenn der Container beim
 * Initialisieren noch keine Größe hat (CSS lädt nach). Bis zur ersten
 * Nutzerinteraktion wird bei Größenänderungen neu eingepasst.
 */
export function einpassen(karte: L.Map, grenzen: L.LatLngBounds) {
  if (!grenzen.isValid()) return;
  const el = karte.getContainer();
  let benutzt = false;
  let einpassenLaeuft = false;
  karte.on('dragstart zoomstart', () => {
    if (!einpassenLaeuft) benutzt = true;
  });
  const passen = () => {
    if (benutzt || el.clientWidth === 0 || el.clientHeight === 0) return;
    einpassenLaeuft = true;
    karte.invalidateSize({ animate: false });
    karte.fitBounds(grenzen, { padding: [24, 24], animate: false });
    einpassenLaeuft = false;
  };
  new ResizeObserver(passen).observe(el);
  passen();
}

export function farbe(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#2e6a4d';
}

export const fotoIcon = (src: string) =>
  L.divIcon({
    className: 'foto-marker',
    html: `<img src="${src}" alt="" loading="lazy">`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });

export { L };
