// src/components/BalanceChart.tsx
//
// Interactive SVG line chart of the projected balance over the horizon.
// Geometry comes from the pure helpers in domain/chartGeometry.ts; this
// file maps coordinates to SVG elements and handles the scrub crosshair.

import { useState } from "react";
import {
  buildBalanceChartGeometry,
  nearestPointIndex,
} from "../domain/chartGeometry";
import { formatDate } from "../utils/dates";
import { colors, chart } from "./ui";
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
  const [active, setActive] = useState<number | null>(null);

  const geo = buildBalanceChartGeometry(timeline, minSafeBalance, W, H);
  if (!geo) return null;

  const { points, linePath, trendPath, floorY, zeroY, padding } = geo;
  const bottom = H - padding;
  const first = points[0];
  const last = points[points.length - 1];
  const min = points[geo.minIndex];

  const areaPath = `${linePath} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`;
  const belowZeroHeight = Math.max(0, bottom - zeroY);

  function handlePointer(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return; // no layout (e.g. jsdom) — ignore
    const xViewBox = ((e.clientX - rect.left) / rect.width) * W;
    setActive(nearestPointIndex(points, xViewBox));
  }

  const activePoint = active !== null ? points[active] : null;
  // Keep the readout within the card; clamp its center between 18%–82%.
  const readoutLeft =
    activePoint !== null
      ? Math.min(82, Math.max(18, (activePoint.x / W) * 100))
      : 0;
  const floorDelta =
    activePoint !== null ? activePoint.balance - minSafeBalance : 0;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Projected account balance over the horizon"
        style={{ display: "block", touchAction: "none" }}
        onPointerDown={handlePointer}
        onPointerMove={handlePointer}
        onPointerLeave={() => setActive(null)}
      >
        <defs>
          <linearGradient id="balance-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(96,165,250,0.28)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0.02)" />
          </linearGradient>
          <clipPath id="balance-below-zero">
            <rect x="0" y={zeroY} width={W} height={belowZeroHeight} />
          </clipPath>
        </defs>

        <path d={areaPath} fill="url(#balance-area)" />
        {belowZeroHeight > 0 && (
          <path
            d={areaPath}
            fill="rgba(249,115,115,0.18)"
            clipPath="url(#balance-below-zero)"
          />
        )}

        {/* Zero line */}
        <line x1={padding} y1={zeroY} x2={W - padding} y2={zeroY} stroke={colors.inputBorder} strokeWidth="1" />
        {/* Safety-floor line (dashed amber) */}
        <line
          x1={padding}
          y1={floorY}
          x2={W - padding}
          y2={floorY}
          stroke={chart.floor}
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.8"
        />

        {/* Smoothed trend overlay (soft, behind the true line) */}
        <path
          d={trendPath}
          fill="none"
          stroke={chart.trend}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.55"
        />

        {/* Balance line — true daily values, thin and crisp on top */}
        <path
          d={linePath}
          fill="none"
          stroke={chart.daily}
          strokeWidth="1.25"
          strokeLinejoin="round"
          opacity="0.85"
        />

        {/* Deepest point (hidden while actively scrubbing to reduce clutter) */}
        {activePoint === null && (
          <>
            <circle cx={min.x} cy={min.y} r="3" fill={colors.danger} />
            <text
              x={min.x}
              y={Math.max(min.y - 6, 9)}
              fill={colors.danger}
              fontSize="9"
              textAnchor={min.x < 40 ? "start" : min.x > W - 40 ? "end" : "middle"}
            >
              {money0(min.balance)}
            </text>
          </>
        )}

        {/* Scrub crosshair */}
        {activePoint !== null && (
          <>
            <line
              x1={activePoint.x}
              y1={padding}
              x2={activePoint.x}
              y2={bottom}
              stroke={colors.link}
              strokeWidth="1"
              opacity="0.7"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="3.5" fill={colors.link} />
          </>
        )}

        {/* Horizon endpoints */}
        {activePoint === null && (
          <>
            <text x={first.x} y={H - 1} fill={colors.muted} fontSize="9" textAnchor="start">
              {formatDate(first.date)}
            </text>
            <text x={last.x} y={H - 1} fill={colors.muted} fontSize="9" textAnchor="end">
              {formatDate(last.date)}
            </text>
          </>
        )}
      </svg>

      {/* Floating readout while scrubbing */}
      {activePoint !== null && (
        <div
          style={{
            ...styles.readout,
            left: `${readoutLeft}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div style={styles.readoutDate}>{formatDate(activePoint.date)}</div>
          <div
            style={{
              ...styles.readoutBalance,
              color:
                activePoint.balance < 0
                  ? colors.danger
                  : activePoint.balance < minSafeBalance
                  ? colors.amber
                  : colors.text,
            }}
          >
            {money0(activePoint.balance)}
          </div>
          <div style={styles.readoutFloor}>
            {floorDelta >= 0
              ? `${money0(floorDelta)} above floor`
              : `${money0(Math.abs(floorDelta))} below floor`}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  readout: {
    position: "absolute",
    top: 2,
    pointerEvents: "none",
    background: "rgba(9,9,11,0.95)",
    border: `1px solid ${colors.inputBorder}`,
    borderRadius: 8,
    padding: "4px 8px",
    minWidth: 96,
    textAlign: "center",
    boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
  },
  readoutDate: {
    fontSize: 10,
    color: colors.muted,
  },
  readoutBalance: {
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  readoutFloor: {
    fontSize: 10,
    color: colors.muted,
  },
};
