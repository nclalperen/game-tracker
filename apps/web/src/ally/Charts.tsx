import React from "react";
import type { Reply } from "@tracker/core";

type ChartInput = NonNullable<Reply["charts"]>;

const LazyChart = React.lazy(() => import("./charts/LineChart"));

export function ChartsBlock({ charts }: { charts: ChartInput | undefined }) {
  if (!charts || charts.length === 0) return null;
  return (
    <div className="mt-3 space-y-4">
      {charts.map((chart: ChartInput[number]) => (
        <React.Suspense key={chart.id} fallback={<div className="h-24 rounded-lg bg-zinc-100" />}>
          <LazyChart chart={chart} />
        </React.Suspense>
      ))}
    </div>
  );
}
