import type { APIRoute, GetStaticPaths } from 'astro';
import { alsGpx } from '../../lib/gpx';
import { alleTouren, type Tour } from '../../lib/touren';

export const getStaticPaths = (async () => {
  const touren = await alleTouren();
  return touren.map((tour) => ({ params: { slug: tour.id }, props: { tour } }));
}) satisfies GetStaticPaths;

/** Liefert nur den gekürzten Track (ohne Privatzone und ohne Zeitstempel). */
export const GET: APIRoute<{ tour: Tour }> = ({ props }) =>
  new Response(alsGpx(props.tour.daten.titel, props.tour.punkte), {
    headers: { 'Content-Type': 'application/gpx+xml; charset=utf-8' },
  });
