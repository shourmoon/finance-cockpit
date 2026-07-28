// src/components/shared.tsx
//
// Small UI helpers shared between App.tsx and the tab components.

import { useState } from "react";
import { formatDate } from "../utils/dates";
import { colors } from "./ui";
import type { TopUpClass } from "../utils/topUpClass";

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
 * Classifies a one-time transaction as an ordinary entry or as a top-up
 * from savings (with its reason).
 *
 * Needed because not every top-up starts from the dashboard's Apply
 * button: money often moves before the app ever predicted the shortfall,
 * and that transfer still has to be recorded as a top-up or the coverage
 * metrics would count the month as clean when it wasn't.
 */
export function TopUpClassSelect({
  value,
  onChange,
  inputStyle,
  ariaLabel = "Classify transaction",
}: {
  value: TopUpClass;
  onChange: (value: TopUpClass) => void;
  inputStyle?: React.CSSProperties;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as TopUpClass)}
      style={inputStyle}
    >
      <option value="none">Ordinary transaction</option>
      <option value="oneOff">Top-up · one-off</option>
      <option value="shortfall">Top-up · recurring shortfall</option>
    </select>
  );
}


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
