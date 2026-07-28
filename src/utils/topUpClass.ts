// src/utils/topUpClass.ts
//
// Maps a transaction's stored top-up markers onto the single value the
// classification select uses, and back. Kept out of the component file so
// that file exports only components (react-refresh).

/** The three states a one-time transaction can be classified into. */
export type TopUpClass = "none" | "oneOff" | "shortfall";

export function topUpClassOf(txn: {
  kind?: "topUp";
  reason?: "oneOff" | "shortfall";
}): TopUpClass {
  if (txn.kind !== "topUp") return "none";
  return txn.reason === "shortfall" ? "shortfall" : "oneOff";
}
