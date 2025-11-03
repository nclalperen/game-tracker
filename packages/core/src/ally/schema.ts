import { z } from "zod";

export const ZResult = z.object({
  id: z.string(),
  rank: z.number().finite(),
  reason: z.string().min(1),
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
