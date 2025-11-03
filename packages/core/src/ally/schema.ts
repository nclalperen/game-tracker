import { z } from "zod";

export const ZResult = z.object({
  id: z.string().min(1),
  rank: z
    .preprocess((value) => {
      if (typeof value === "number") {
        return value;
      }
      if (typeof value === "string") {
        const numeric = Number.parseFloat(value.replace(/[^0-9.\-]+/g, ""));
        if (Number.isFinite(numeric)) {
          return numeric;
        }
      }
      return Number.NaN;
    }, z.number().finite())
    .transform((value) => (value === 0 ? 1 : value)),
  reason: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length === 0 ? "Recommendation provided without extra context." : trimmed;
      }
      return value;
    }, z.string())
    .default("Recommendation provided without extra context."),
});

export const ZChart = z.object({
  id: z.string(),
  title: z.string(),
  unit: z.enum(["h", "%", "count"]),
  series: z.array(
    z.object({
      name: z.string(),
      points: z.array(z.tuple([z.number().finite(), z.number().finite()])),
    }),
  ),
});

export const ZReply = z.object({
  results: z.array(ZResult),
  charts: z.array(ZChart).optional(),
  notes: z.string().optional(),
});

export type Reply = z.infer<typeof ZReply>;
