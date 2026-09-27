import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const sterne = z.number().int().min(1).max(5);

const touren = defineCollection({
  // Jede Tour ist ein Ordner: src/content/touren/<slug>/index.md (+ track.gpx, fotos/)
  loader: glob({
    pattern: '*/index.md',
    base: './src/content/touren',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: z
    .object({
      titel: z.string(),
      status: z.enum(['geplant', 'gefahren']),
      datum: z.coerce.date().optional(),
      komoot: z.string().url().optional(),
      region: z.string().optional(),
      bewertung: z
        .object({ anspruch: sterne, schoenheit: sterne, ruhe: sterne })
        .partial()
        .optional(),
      tags: z.array(z.string()).default([]),
      belag: z.array(z.string()).default([]),
      /** Dateiname in fotos/, sonst das erste Foto */
      titelbild: z.string().optional(),
      /** Wird auf die Kamerazeit addiert, z. B. „+00:03:20“ wenn die Kamera 3:20 min nachgeht */
      kamera_versatz: z.string().optional(),
      /** Manuelle Foto-Positionen: { "IMG_1234.jpg": { km: 42.5 } } */
      fotos: z.record(z.string(), z.object({ km: z.number().nonnegative() })).optional(),
    })
    .superRefine((d, ctx) => {
      if (d.status === 'gefahren' && !d.datum) {
        ctx.addIssue({ code: 'custom', path: ['datum'], message: 'Gefahrene Touren brauchen ein Datum' });
      }
    }),
});

export const collections = { touren };
