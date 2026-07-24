// src/components/ui.ts
//
// Shared visual tokens — the single source of truth for cards, titles,
// buttons, inputs, and chips so every tab (Dashboard, Rules, Mortgage)
// reads as one design system. Import these instead of re-declaring
// per-component styles.

import type { CSSProperties } from "react";

export const colors = {
  bg: "#020617",
  cardBorder: "#27272a",
  text: "#e4e4e7",
  title: "#f4f4f5",
  muted: "#9ca3af",
  faint: "#6b7280",
  inputBg: "#18181b",
  inputBorder: "#3f3f46",
  green: "#22c55e",
  greenInk: "#022c22",
  blue: "#3b82f6",
  blueInk: "#f9fafb",
  danger: "#f97373",
  amber: "#fbbf24",
  positive: "#4ade80",
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
    background: "#b91c1c",
    color: "#fef2f2",
    fontWeight: 600,
    cursor: "pointer",
  } as CSSProperties,
};
