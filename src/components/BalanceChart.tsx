// src/components/BalanceChart.tsx
//
// Hand-rolled SVG line chart of the projected balance over the horizon.
// All geometry comes from the pure helper in domain/chartGeometry.ts;
// this file only maps coordinates to SVG elements (no dependencies).

import { buildBalanceChartGeometry } from "../domain/chartGeometry";
import { formatDate } from "../utils/dates";
import type { TimelinePoint } from "../domain/types";

function money0(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default function BalanceChart({
  timeline,
  minSafeBalance,
}: {
  timeline: TimelinePoint[];
  minSafeBalance: number;
}) {
  const W = 320;
  const H = 148;
  const geo = buildBalanceChartGeometry(timeline, minSafeBalance, W, H);
  if (!geo) return null;

  const { points, linePath, floorY, zeroY, padding } = geo;
  const bottom = H - padding;
  const first = points[0];
  const last = points[points.length - 1];
  const min = points[geo.minIndex];

  // Filled area under the balance line, plus a red-tinted copy clipped to
  // the below-zero band so an underwater stretch reads at a glance.
  const areaPath = `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
  const belowZeroHeight = Math.max(0, bottom - zeroY);
  // Keep the min-balance label from spilling off either edge.
  const minAnchor =
    min.x < 40 ? "start" : min.x > W - 40 ? "end" : "middle";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label="Projected account balance over the horizon"
      style={{ display: "block" }}
    >
      <defs>
        <clipPath id="balance-below-zero">
          <rect x="0" y={zeroY} width={W} height={belowZeroHeight} />
        </clipPath>
      </defs>

      <path d={areaPath} fill="rgba(96,165,250,0.15)" />
      {belowZeroHeight > 0 && (
        <path
          d={areaPath}
          fill="rgba(249,115,115,0.25)"
          clipPath="url(#balance-below-zero)"
        />
      )}

      {/* Zero line */}
      <line x1={padding} y1={zeroY} x2={W - padding} y2={zeroY} stroke="#3f3f46" strokeWidth="1" />
      {/* Safety-floor line (dashed amber) */}
      <line
        x1={padding}
        y1={floorY}
        x2={W - padding}
        y2={floorY}
        stroke="#fbbf24"
        strokeWidth="1"
        strokeDasharray="4 3"
      />

      {/* Balance line */}
      <path d={linePath} fill="none" stroke="#60a5fa" strokeWidth="2" />

      {/* Deepest point */}
      <circle cx={min.x} cy={min.y} r="3" fill="#f97373" />
      <text
        x={min.x}
        y={Math.max(min.y - 6, 9)}
        fill="#f97373"
        fontSize="9"
        textAnchor={minAnchor}
      >
        {money0(min.balance)}
      </text>

      {/* Horizon endpoints */}
      <text x={first.x} y={H - 1} fill="#9ca3af" fontSize="9" textAnchor="start">
        {formatDate(first.date)}
      </text>
      <text x={last.x} y={H - 1} fill="#9ca3af" fontSize="9" textAnchor="end">
        {formatDate(last.date)}
      </text>
    </svg>
  );
}
