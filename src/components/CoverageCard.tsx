// src/components/CoverageCard.tsx
//
// "Did one salary cover the household, unaided?" — the running score of
// every applied top-up, plus the forward read from the current projection.
//
// Metrics are shown as soon as a single known month exists — including the
// current, in-progress one: this app forecasts ahead, so a top-up is rarely
// a day-30 surprise, and hiding a real, already-recorded draw until the
// month closes was worse than showing a number that might still move. The
// in-progress month is marked (dashed bar, "still open" in its tooltip) so
// it reads as provisional without being invisible. The hero leads with the
// forward read until there is any known month at all, since that read is
// useful from the very first day.

import type { CoverageMetrics, MonthBucket } from "../domain/resilience";
import { formatDate, monthYearLabel } from "../utils/dates";
import { ui, colors } from "./ui";

export default function CoverageCard({
  metrics,
  trackingSince,
  needsTopUp,
  slack,
  slackDate,
  formatMoney,
}: {
  metrics: CoverageMetrics;
  trackingSince?: string;
  /** True when the projection expects a shortfall inside the horizon. */
  needsTopUp: boolean;
  /** Headroom above the floor at the tightest projected day. */
  slack: number;
  slackDate: string | null;
  formatMoney: (amount: number) => string;
}) {
  const { knownMonths, cleanMonths, months } = metrics;
  // The history leads as soon as there is any known month to report.
  const hasHistory = knownMonths > 0;
  const latest = months[months.length - 1];
  const latestInProgress = latest?.known && !latest.complete;

  const peak = Math.max(...months.map((m) => m.total), 1);

  return (
    <div style={ui.card}>
      <h3 style={{ ...ui.cardTitle, marginBottom: 3 }}>One-Salary Coverage</h3>

      <div style={styles.caption}>
        {trackingSince
          ? `Tracking since ${formatDate(trackingSince)} · ${knownMonths} month${
              knownMonths === 1 ? "" : "s"
            } tracked${latestInProgress ? " (this month in progress)" : ""}`
          : "Tracking top-ups from now on"}
      </div>

      {/* Hero: the history once it means something, the forward read before
          then — which is useful from the very first day. */}
      {hasHistory ? (
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
        <Stat k="Avg monthly gap" v={formatMoney(metrics.averageMonthlyGap)} />
        <Stat
          k="Typical top-up"
          v={metrics.typicalTopUp === null ? "—" : formatMoney(metrics.typicalTopUp)}
        />
        {metrics.secondSalaryKept !== null && (
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
  formatMoney,
}: {
  bucket: MonthBucket;
  peak: number;
  formatMoney: (amount: number) => string;
}) {
  const openSuffix = bucket.known && !bucket.complete ? ", still open" : "";
  const label = !bucket.known
    ? `${bucket.monthKey}: before tracking began`
    : bucket.total === 0
    ? `${bucket.monthKey}: no top-up needed${openSuffix}`
    : `${bucket.monthKey}: ${formatMoney(bucket.total)} topped up${openSuffix}`;
  // The in-progress month is dashed rather than solid, since its total
  // could still grow before the month closes.
  const openStyle: React.CSSProperties = !bucket.complete
    ? { outline: `1px dashed ${colors.muted}`, outlineOffset: 1 }
    : {};

  if (!bucket.known) {
    return <span style={{ ...styles.colUnknown, ...openStyle }} title={label} />;
  }
  if (bucket.total === 0) {
    return <span style={{ ...styles.colClean, ...openStyle }} title={label} />;
  }
  // One bar per assisted month, height proportional to what was drawn.
  return (
    <span style={{ ...styles.col, ...openStyle }} title={label}>
      <span
        style={{ ...styles.segDrawn, height: `${(bucket.total / peak) * 100}%` }}
      />
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
  segDrawn: {
    display: "block",
    borderRadius: "2px 2px 0 0",
    background: "rgba(251, 191, 36, 0.22)",
    borderTop: `2px solid ${colors.amber}`,
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
