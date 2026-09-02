// src/components/shared.tsx
//
// Small UI helpers shared between App.tsx and the tab components.

import { useState } from "react";
import { formatDate } from "../utils/dates";
import { colors } from "./ui";

/**
 * Numeric input that tolerates in-progress typing. A controlled
 * `<input type="number">` reports "" for intermediate states like "-"
 * or "1.", which a naive Number() coercion turns into 0 — eating the
 * minus sign and making negative amounts untypable. This keeps the raw
 * text locally and only commits finite parses to the caller.
 */
export function NumberInput({
  value,
  onChange,
  inputStyle,
  ariaLabel,
  placeholder,
}: {
  value: number;
  onChange: (val: number) => void;
  inputStyle?: React.CSSProperties;
  ariaLabel?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(String(value));

  // Resync when the value changes externally, but never clobber text
  // that already parses to the current value (mid-edit equivalence).
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (Number(text) !== value) setText(String(value));
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const n = Number(t.replace(/,/g, ""));
        if (t.trim() !== "" && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => {
        // Abandoned partial input ("-", "1.", "") snaps back to the value.
        if (Number(text) !== value) setText(String(value));
      }}
      style={inputStyle}
    />
  );
}

/**
 * Marks a one-time transaction as money moved in from savings.
 *
 * Needed because not every top-up starts from the dashboard's Apply
 * button: money often moves before the app ever predicted the shortfall,
 * and that transfer still has to be recorded as a top-up or the coverage
 * metrics would count the month as clean when it wasn't.
 *
 * One checkbox, because there is one kind of top-up. It used to be a
 * three-way select carrying the reason as well, which made recording a
 * transfer a small act of self-assessment at the least convenient moment.
 */
export function TopUpToggle({
  checked,
  onChange,
  label = "Top-up from savings",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label style={topUpToggleStyles.row}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

const topUpToggleStyles: Record<string, React.CSSProperties> = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: colors.muted,
    cursor: "pointer",
  },
};


/**
 * Wraps a native date input and shows the selected date in the
 * product's human-friendly format (DD MMM 'YY) underneath. The browser
 * input uses YYYY-MM-DD internally; users always see both.
 */
export function DateInputWithDisplay({
  value,
  onChange,
  inputStyle,
  captionStyle,
  ariaLabel,
}: {
  value: string;
  onChange: (val: string) => void;
  inputStyle: React.CSSProperties;
  captionStyle?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <input
        type="date"
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      <span
        style={{ fontSize: 12, color: colors.muted, marginTop: 4, ...captionStyle }}
      >
        {formatDate(value) || "—"}
      </span>
    </div>
  );
}
