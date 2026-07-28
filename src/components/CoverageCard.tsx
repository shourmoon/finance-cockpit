// src/components/CoverageCard.tsx
//
// "Did one salary cover the household, unaided?" — the running score of
// every applied top-up, plus the forward read from the current projection.
//
// Two states by design. With little history the metrics can't say anything
// honest, so the forward read leads and the history accrues behind it; once
// six complete months exist the rate-based metrics appear. Rate metrics are
// deliberately withheld early — an average over two months is noise wearing
// a number's clothes.

import type { CoverageMetrics, MonthBucket } from "../domain/resilience";
import type { CoverageLens } from "../domain/types";
import { formatDate, monthYearLabel } from "../utils/dates";
import { ui, colors } from "./ui";

/** Complete months required before rate-based metrics are shown. */
const MIN_MONTHS_FOR_RATES = 6;

export default function CoverageCard({
  metrics,
  lens,
  onLensChange,
  trackingSince,
  needsTopUp,
  slack,
  slackDate,
  formatMoney,
}: {
  metrics: CoverageMetrics;
  lens: CoverageLens;
  onLensChange: (lens: CoverageLens) => void;
  trackingSince?: string;
  /** True when the projection expects a shortfall inside the horizon. */
  needsTopUp: boolean;
  /** Headroom above the floor at the tightest projected day. */
  slack: number;
  slackDate: string | null;
  formatMoney: (amount: number) => string;
}) {
  const { knownMonths, cleanMonths, months } = metrics;
  const mature = knownMonths >= MIN_MONTHS_FOR_RATES;

  // Bars rescale to the active lens: a $350 shortfall is invisible on a
  // scale set by a $2,400 shock, which would defeat the point of the lens.
  const peak = Math.max(...months.map((m) => m.total), 1);

  return (
    <div style={ui.card}>
      <div style={styles.headerRow}>
        <h3 style={{ ...ui.cardTitle, marginBottom: 0 }}>One-Salary Coverage</h3>
        <div style={styles.seg} role="group" aria-label="Coverage lens">
          {(["all", "recurring"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lens === l}
              onClick={() => onLensChange(l)}
              style={lens === l ? styles.segOn : styles.segOff}
            >
              {l === "all" ? "All draws" : "Recurring only"}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.caption}>
        {trackingSince
          ? `Tracking since ${formatDate(trackingSince)} · ${knownMonths} complete month${
              knownMonths === 1 ? "" : "s"
            }`
          : "Tracking top-ups from now on"}
      </div>

      {/* Hero: the history once it means something, the forward read before
          then — which is useful from the very first day. */}
      {mature ? (
        <>
          <div style={styles.hero}>
            <span style={{ ...styles.heroBig, color: heroColor(cleanMonths, knownMonths) }}>
              {cleanMonths} of {knownMonths}
            </span>
            <span style={styles.heroOf}>months on one salary</span>
          </div>
          <div style={styles.verdict}>{verdict(metrics)}</div>
        </>
      ) : (
        <>
          <div style={styles.hero}>
            <span style={{ ...styles.heroBig, color: needsTopUp ? colors.amber : colors.positive }}>
              {needsTopUp ? "Top-up due" : "Clean"}
            </span>
            <span style={styles.heroOf}>over your horizon</span>
          </div>
          <div style={styles.verdict}>
            {needsTopUp
              ? "A shortfall is projected — see the top-up plan above."
              : slackDate
              ? `${formatMoney(slack)} of slack at the tightest point (${formatDate(slackDate)}).`
              : "No shortfall projected."}
          </div>
        </>
      )}

      {months.length > 0 && (
        <>
          <div style={styles.bars}>
            {months.map((m) => (
              <MonthBar
                key={m.monthKey}
                bucket={m}
                peak={peak}
                lens={lens}
                formatMoney={formatMoney}
              />
            ))}
          </div>
          <div style={styles.axis}>
            {months.map((m) => (
              <span key={m.monthKey} style={styles.axisTick}>
                {monthYearLabel(`${m.monthKey}-01`).charAt(0)}
              </span>
            ))}
          </div>
        </>
      )}

      <div style={styles.stats}>
        <Stat k="Total topped up" v={formatMoney(metrics.totalToppedUp)} />
        <Stat
          k="Streak"
          v={String(metrics.streakCurrent)}
          d={`months now · best ${metrics.streakBest}`}
        />
        {mature && (
          <Stat k="Avg monthly gap" v={formatMoney(metrics.averageMonthlyGap)} />
        )}
        {mature && (
          <Stat
            k="Typical top-up"
            v={metrics.typicalTopUp === null ? "—" : formatMoney(metrics.typicalTopUp)}
          />
        )}
        {mature && metrics.secondSalaryKept !== null && (
          <Stat
            k="2nd salary kept"
            v={`${metrics.secondSalaryKept.toFixed(1)}%`}
            good={metrics.secondSalaryKept >= 97}
          />
        )}
      </div>
    </div>
  );
}

function MonthBar({
  bucket,
  peak,
  lens,
  formatMoney,
}: {
  bucket: MonthBucket;
  peak: number;
  lens: CoverageLens;
  formatMoney: (amount: number) => string;
}) {
  const label = !bucket.known
    ? `${bucket.monthKey}: before tracking began`
    : bucket.total === 0
    ? `${bucket.monthKey}: no top-up needed`
    : `${bucket.monthKey}: ${formatMoney(bucket.total)} topped up`;

  if (!bucket.known) {
    return <span style={styles.colUnknown} title={label} />;
  }
  if (bucket.total === 0) {
    return <span style={styles.colClean} title={label} />;
  }
  // Stacked so a month holding both a shock and a shortfall reads as both —
  // but only the portions this lens actually counts are drawn. Under
  // "recurring only" the shock is not part of the view, and drawing it would
  // both misrepresent the month and blow past the rescaled axis.
  const showOneOff = lens === "all" && bucket.oneOff > 0;
  const oneOffPct = (bucket.oneOff / peak) * 100;
  const shortfallPct = (bucket.shortfall / peak) * 100;
  return (
    <span style={styles.col} title={label}>
      {showOneOff && <span style={{ ...styles.segOneOff, height: `${oneOffPct}%` }} />}
      {bucket.shortfall > 0 && (
        <span style={{ ...styles.segShortfall, height: `${shortfallPct}%` }} />
      )}
    </span>
  );
}

function Stat({ k, v, d, good }: { k: string; v: string; d?: string; good?: boolean }) {
  return (
    <div style={styles.stat}>
      <span style={styles.statK}>{k}</span>
      <span style={{ ...styles.statV, ...(good ? { color: colors.positive } : {}) }}>{v}</span>
      {d && <span style={styles.statD}>{d}</span>}
    </div>
  );
}

function heroColor(clean: number, known: number): string {
  if (known === 0) return colors.text;
  if (clean === known) return colors.positive;
  return clean / known >= 0.75 ? colors.text : colors.amber;
}

function verdict(m: CoverageMetrics): string {
  if (m.totalToppedUp === 0) {
    return "One salary covered every obligation — no top-up needed at all.";
  }
  if (m.cleanMonths === 0) {
    return "Every month needed a top-up — this looks structural, not variance.";
  }
  if (m.streakBest <= 2) {
    return `Best unbroken run was ${m.streakBest} month${
      m.streakBest === 1 ? "" : "s"
    } — top-ups are frequent, even if not constant.`;
  }
  return `Best run ${m.streakBest} months — top-ups look like isolated events.`;
}

const styles: Record<string, React.CSSProperties> = {
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 3,
  },
  seg: {
    display: "flex",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 8,
    overflow: "hidden",
  },
  segOff: {
    background: "transparent",
    border: "none",
    padding: "4px 9px",
    fontSize: 11,
    fontWeight: 600,
    color: colors.muted,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  segOn: {
    background: colors.blue,
    border: "none",
    padding: "4px 9px",
    fontSize: 11,
    fontWeight: 600,
    color: colors.blueInk,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  caption: { fontSize: 11, color: colors.faint, marginBottom: 9 },
  hero: { display: "flex", alignItems: "baseline", gap: 7, marginBottom: 2 },
  heroBig: { fontSize: 24, fontWeight: 700, lineHeight: 1.05 },
  heroOf: { fontSize: 12.5, color: colors.muted },
  verdict: { fontSize: 12, color: colors.textSoft, marginBottom: 11 },

  bars: { display: "flex", gap: 3, alignItems: "flex-end", height: 38 },
  col: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    height: "100%",
    gap: 1,
  },
  colClean: {
    flex: 1,
    alignSelf: "flex-end",
    height: 3,
    borderRadius: 2,
    background: colors.positive,
    opacity: 0.45,
  },
  colUnknown: {
    flex: 1,
    alignSelf: "flex-end",
    height: 3,
    borderRadius: 2,
    background: colors.cardBorder,
  },
  segOneOff: {
    display: "block",
    borderRadius: "2px 2px 0 0",
    background: "rgba(251, 191, 36, 0.22)",
    borderTop: `2px solid ${colors.amber}`,
  },
  segShortfall: {
    display: "block",
    borderRadius: "2px 2px 0 0",
    background: "rgba(249, 115, 115, 0.22)",
    borderTop: `2px solid ${colors.danger}`,
  },
  axis: { display: "flex", gap: 3, marginTop: 4 },
  axisTick: {
    flex: 1,
    textAlign: "center",
    fontSize: 9,
    lineHeight: 1,
    color: colors.faint,
    fontVariantNumeric: "tabular-nums",
  },

  stats: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginTop: 11,
    paddingTop: 10,
    borderTop: `1px solid ${colors.cardBorder}`,
  },
  stat: { display: "flex", flexDirection: "column", gap: 1 },
  statK: { ...ui.miniLabel, letterSpacing: "0.04em", lineHeight: 1.25 },
  statV: { fontSize: 14, fontWeight: 700, color: colors.text },
  statD: { fontSize: 10.5, color: colors.faint },
};
