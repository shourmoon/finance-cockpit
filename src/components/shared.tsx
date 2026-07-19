// src/components/shared.tsx
//
// Small UI helpers shared between App.tsx and the tab components.

import { formatDate } from "../utils/dates";

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
}: {
  value: string;
  onChange: (val: string) => void;
  inputStyle: React.CSSProperties;
  captionStyle?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      <span
        style={{ fontSize: 12, color: "#9ca3af", marginTop: 4, ...captionStyle }}
      >
        {formatDate(value) || "—"}
      </span>
    </div>
  );
}
