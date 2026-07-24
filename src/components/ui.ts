// src/components/ui.ts
//
// Shared visual tokens — the single source of truth for cards, titles,
// buttons, inputs, and chips so every tab (Dashboard, Rules, Mortgage)
// reads as one design system. Import these instead of re-declaring
// per-component styles.

import type { CSSProperties } from "react";

// The single source of truth for colour. Every hex in the app lives here;
// components reference these names, never raw literals (an eslint rule
// enforces it). Near-duplicate values that had drifted in (#a1a1aa vs
// #9ca3af, #e5e7eb vs #e4e4e7, #4b5563 vs #3f3f46, the several near-black
// nested surfaces) are intentionally collapsed to one token each.
export const colors = {
  // Grounds & surfaces
  bg: "#020617",
  surfaceInset: "#09090b", // nested cards, empty states
  cardBorder: "#27272a",
  hairline: "#1f2933", // list-row dividers (rules / events)
  dayDivider: "#33343b", // day-group divider in the ledger

  // Text
  title: "#f4f4f5",
  text: "#e4e4e7",
  textSoft: "#d4d4d8", // summary values
  muted: "#9ca3af", // secondary text / labels
  faint: "#6b7280", // tertiary labels
  glyph: "#52525b", // arrows / chevrons

  // Inputs
  inputBg: "#18181b",
  inputBorder: "#3f3f46",

  // Brand / actions
  blue: "#3b82f6",
  blueInk: "#f9fafb",
  blueStrong: "#1d4ed8", // active tab fill / banner
  blueEdge: "#2563eb", // active tab border
  link: "#93c5fd", // text links (show-more, sync, chart cursor)
  tabBorder: "#374151", // inactive tab border

  // Money / status
  green: "#22c55e",
  greenInk: "#022c22",
  positive: "#4ade80",
  positiveSoft: "#6ee7b7", // incremental savings
  danger: "#f97373",
  dangerText: "#fecaca", // text on danger surfaces
  dangerSolid: "#b91c1c", // filled destructive button
  dangerInk: "#fef2f2",
  dangerBorder: "#7f1d1d",
  dangerSurface: "#1f0b0b",
  rose: "#fda4af", // outline delete-button text
  error: "#f87171", // sync error text
  amber: "#fbbf24",
  amberEdge: "#92400e", // warning surface border
};

// Balance chart lines that aren't part of the core UI palette.
export const chart = {
  floor: "#f59e0b", // min-safe-balance dashed line
  trend: "#818cf8", // smoothed trend line
  daily: "#60a5fa", // daily balance line
};

export const ui = {
  // Denser than a typical card: tighter padding and a smaller gap between
  // cards so more data lands on screen. Applied through this shared token,
  // every tab tightens together.
  card: {
    borderRadius: 12,
    padding: 13,
    marginBottom: 12,
    background:
      "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
    border: `1px solid ${colors.cardBorder}`,
    boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
  } as CSSProperties,

  cardTitle: {
    marginTop: 0,
    marginBottom: 10,
    fontSize: 16,
    fontWeight: 600,
    color: colors.title,
  } as CSSProperties,

  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: -6,
    marginBottom: 12,
  } as CSSProperties,

  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  } as CSSProperties,

  input: {
    padding: 8,
    fontSize: 14,
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg,
    color: colors.text,
    width: "100%",
    boxSizing: "border-box",
  } as CSSProperties,

  // Green pill for "+ Add" actions.
  addButton: {
    padding: "6px 12px",
    fontSize: 14,
    borderRadius: 999,
    border: "none",
    background: colors.green,
    color: colors.greenInk,
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,

  // Blue pill for primary actions (Edit / Save).
  primaryButton: {
    padding: "6px 14px",
    fontSize: 13,
    borderRadius: 999,
    border: "none",
    background: colors.blue,
    color: colors.blueInk,
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,

  deleteButton: {
    fontSize: 14,
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg,
    color: "#fda4af",
    cursor: "pointer",
  } as CSSProperties,

  chip: {
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 999,
    border: `1px solid ${colors.inputBorder}`,
    background: "transparent",
    color: colors.muted,
    cursor: "pointer",
  } as CSSProperties,

  chipActive: {
    padding: "4px 10px",
    fontSize: 12,
    borderRadius: 999,
    border: `1px solid ${colors.blue}`,
    background: colors.blue,
    color: colors.blueInk,
    cursor: "pointer",
  } as CSSProperties,

  fieldLabel: {
    display: "block",
    fontSize: 11,
    color: colors.muted,
    marginBottom: 3,
  } as CSSProperties,

  // Small-caps section/group label shared by the dashboard metric grid,
  // event-list month separators, and mortgage sub-headings — these were
  // three near-identical inline copies with slightly drifted sizes/colors.
  miniLabel: {
    fontSize: 11,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: colors.faint,
  } as CSSProperties,

  // Modal shell — the surface matches the app's card (same gradient,
  // border, shadow) so dialogs read as elevated cards, not a different
  // blue-grey theme.
  modalBackdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(2,6,23,0.72)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 999,
    padding: 16,
  } as CSSProperties,

  modalSurface: {
    background:
      "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
    border: `1px solid ${colors.cardBorder}`,
    borderRadius: 12,
    padding: 16,
    width: "100%",
    maxWidth: 400,
    boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
    maxHeight: "90vh",
    overflowY: "auto",
    color: colors.text,
  } as CSSProperties,

  // Neutral pill for secondary actions (Cancel).
  secondaryButton: {
    padding: "8px 14px",
    fontSize: 14,
    borderRadius: 999,
    border: `1px solid ${colors.inputBorder}`,
    background: colors.inputBg,
    color: colors.text,
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,

  // Filled red pill for destructive actions (Delete).
  dangerButton: {
    padding: "8px 14px",
    fontSize: 14,
    borderRadius: 999,
    border: "none",
    background: colors.dangerSolid,
    color: colors.dangerInk,
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,
};
