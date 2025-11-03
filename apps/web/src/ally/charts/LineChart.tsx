import React from "react";
import type { Reply } from "@tracker/core";

type Chart = NonNullable<Reply["charts"]>[number];

type Props = {
  chart: Chart;
};

const WIDTH = 360;
const HEIGHT = 200;
const PADDING = 32;
const COLORS = ["#2563eb", "#16a34a", "#f97316", "#9333ea", "#ef4444", "#0f172a"];

function computeBounds(series: Chart["series"]) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const line of series) {
    for (const [x, y] of line.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
    minX = 0;
    maxX = 1;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY === maxY) {
    minY = 0;
    maxY = minY + 1;
  }

  return { minX, maxX, minY, maxY };
}

function scalePoint(
  x: number,
  y: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
): { sx: number; sy: number } {
  const { minX, maxX, minY, maxY } = bounds;
  const xRange = maxX - minX || 1;
  const yRange = maxY - minY || 1;
  const sx = PADDING + ((x - minX) / xRange) * (WIDTH - PADDING * 2);
  const sy = HEIGHT - PADDING - ((y - minY) / yRange) * (HEIGHT - PADDING * 2);
  return { sx, sy };
}

function buildPolyline(points: [number, number][], bounds: { minX: number; maxX: number; minY: number; maxY: number }) {
  return points
    .map(([x, y]) => {
      const { sx, sy } = scalePoint(x, y, bounds);
      return `${sx},${sy}`;
    })
    .join(" ");
}

function formatValue(value: number, unit: Chart["unit"]) {
  switch (unit) {
    case "h":
      return `${value.toFixed(1)} h`;
    case "%":
      return `${value.toFixed(0)}%`;
    default:
      return value.toString();
  }
}

export default function LineChart({ chart }: Props) {
  const bounds = React.useMemo(() => computeBounds(chart.series), [chart.series]);
  const xTicks = React.useMemo(() => {
    const ticks: number[] = [];
    const step = (bounds.maxX - bounds.minX) / 4 || 1;
    for (let i = 0; i <= 4; i += 1) {
      ticks.push(Number(bounds.minX + i * step));
    }
    return ticks;
  }, [bounds.maxX, bounds.minX]);

  const yTicks = React.useMemo(() => {
    const ticks: number[] = [];
    const step = (bounds.maxY - bounds.minY) / 4 || 1;
    for (let i = 0; i <= 4; i += 1) {
      ticks.push(Number(bounds.minY + i * step));
    }
    return ticks;
  }, [bounds.maxY, bounds.minY]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold text-zinc-800">{chart.title}</h4>
        <span className="text-xs uppercase tracking-wide text-zinc-500">{chart.unit}</span>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={chart.title} className="h-48 w-full">
          <rect
            x={PADDING}
            y={PADDING}
            width={WIDTH - PADDING * 2}
            height={HEIGHT - PADDING * 2}
            fill="none"
            stroke="#e4e4e7"
            strokeWidth={1}
          />
          {yTicks.map((value, index) => {
            const { sy } = scalePoint(bounds.minX, value, bounds);
            return (
              <g key={`y-${index}`}>
                <line
                  x1={PADDING}
                  x2={WIDTH - PADDING}
                  y1={sy}
                  y2={sy}
                  stroke="#f4f4f5"
                  strokeWidth={1}
                />
                <text x={PADDING - 8} y={sy + 4} fontSize={10} textAnchor="end" fill="#a1a1aa">
                  {formatValue(value, chart.unit)}
                </text>
              </g>
            );
          })}
          {xTicks.map((value, index) => {
            const { sx } = scalePoint(value, bounds.minY, bounds);
            return (
              <g key={`x-${index}`}>
                <line
                  x1={sx}
                  x2={sx}
                  y1={PADDING}
                  y2={HEIGHT - PADDING}
                  stroke="#f4f4f5"
                  strokeWidth={1}
                />
                <text x={sx} y={HEIGHT - PADDING + 16} fontSize={10} textAnchor="middle" fill="#a1a1aa">
                  {value.toFixed(0)}
                </text>
              </g>
            );
          })}
          {chart.series.map((series: Chart["series"][number], idx: number) => (
            <polyline
              key={series.name}
              fill="none"
              stroke={COLORS[idx % COLORS.length]}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={buildPolyline(series.points, bounds)}
            />
          ))}
        </svg>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
          {chart.series.map((series: Chart["series"][number], idx: number) => (
            <span key={series.name} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: COLORS[idx % COLORS.length] }}
              />
              {series.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
