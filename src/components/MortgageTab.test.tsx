// src/components/MortgageTab.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MortgageTab from "./MortgageTab";

beforeEach(() => {
  window.localStorage.clear();
  // Deterministic ids for scenarios/patterns/prepayments.
  let n = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `id-${n++}` });
});

function persisted() {
  return JSON.parse(window.localStorage.getItem("finance-cockpit-mortgage-v2")!);
}

describe("MortgageTab", () => {
  it("renders the baseline summary from default terms", () => {
    render(<MortgageTab />);
    expect(screen.getByText("Original loan terms")).toBeInTheDocument();
    expect(screen.getByText("Baseline summary")).toBeInTheDocument();
    // Default 300k @ 5% / 30y => ~$1,610/mo.
    expect(screen.getByText(/\$1,610/)).toBeInTheDocument();
    // Effective APR near the nominal 5% (shown for baseline and actual).
    expect(screen.getAllByText(/5\.1\d%/).length).toBeGreaterThan(0);
  });

  it("recomputes the baseline when the principal changes", () => {
    render(<MortgageTab />);
    const principal = screen.getByDisplayValue("300000");
    fireEvent.change(principal, { target: { value: "600000" } });
    // Doubling the principal roughly doubles the monthly payment (~$3,220).
    expect(screen.getByText(/\$3,22\d/)).toBeInTheDocument();
    expect(persisted().terms.principal).toBe(600000);
  });

  it("updates rate and term and persists them", () => {
    render(<MortgageTab />);
    fireEvent.change(screen.getByDisplayValue("5"), { target: { value: "6" } });
    fireEvent.change(screen.getByDisplayValue("30"), { target: { value: "15" } });
    const p = persisted();
    expect(p.terms.annualRate).toBeCloseTo(0.06, 6);
    expect(p.terms.termMonths).toBe(180);
  });

  it("adds a prepayment, shows savings, then deletes it", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add prepayment"));

    // A new row appears with amount 0; set it to 20000.
    const amountInput = screen.getByDisplayValue("0");
    fireEvent.change(amountInput, { target: { value: "20000" } });

    expect(screen.getByText("Total past prepayments")).toBeInTheDocument();
    expect(persisted().prepayments).toHaveLength(1);
    expect(persisted().prepayments[0].amount).toBe(20000);

    // Delete it.
    fireEvent.click(screen.getByText("✕"));
    expect(screen.getByText(/No prepayments defined yet/)).toBeInTheDocument();
    expect(persisted().prepayments).toHaveLength(0);
  });

  it("ignores a prepayment row with a zero amount when persisting", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add prepayment"));
    // Row exists in the UI but amount 0 => filtered out of persisted log.
    expect(persisted().prepayments).toHaveLength(0);
  });

  it("adds a scenario and shows its results, then deletes it", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    expect(screen.getByDisplayValue("Scenario 1")).toBeInTheDocument();
    expect(persisted().scenarios).toHaveLength(1);

    // The default scenario has a monthly extra pattern.
    expect(screen.getByDisplayValue("Monthly extra")).toBeInTheDocument();

    // Delete the scenario via its header ✕ (first one on the page).
    fireEvent.click(screen.getAllByText("✕")[0]);
    expect(persisted().scenarios).toHaveLength(0);
  });

  it("renames a scenario and toggles it inactive", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    fireEvent.change(screen.getByDisplayValue("Scenario 1"), {
      target: { value: "Aggressive payoff" },
    });
    expect(persisted().scenarios[0].name).toBe("Aggressive payoff");

    const activeToggle = screen.getByRole("checkbox");
    fireEvent.click(activeToggle);
    expect(persisted().scenarios[0].active).toBe(false);
  });

  it("adds each pattern kind to a scenario", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    // Add-pattern buttons (only one scenario is present).
    fireEvent.click(screen.getByText("One-time"));
    fireEvent.click(screen.getByText("Annual"));
    fireEvent.click(screen.getByText("Biweekly"));

    const patterns = persisted().scenarios[0].patterns;
    const kinds = patterns.map((p: any) => p.kind);
    expect(kinds).toContain("monthly"); // the default pattern
    expect(kinds).toContain("oneTime");
    expect(kinds).toContain("yearly");
    expect(kinds).toContain("biweekly");
  });

  it("edits the monthly pattern cadence, revealing conditional fields", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    // The default monthly pattern's cadence select starts on "Due date".
    const cadence = screen.getByDisplayValue("Due date");
    fireEvent.change(cadence, { target: { value: "specific-day" } });
    const dayInput = screen.getByPlaceholderText("Day");
    fireEvent.change(dayInput, { target: { value: "40" } }); // clamps to 28
    expect(persisted().scenarios[0].patterns[0].specificDayOfMonth).toBe(28);

    fireEvent.change(cadence, { target: { value: "nth-weekday" } });
    fireEvent.change(screen.getByPlaceholderText("Nth"), { target: { value: "3" } });
    fireEvent.change(screen.getByDisplayValue("Mon"), { target: { value: "5" } });
    const monthly = persisted().scenarios[0].patterns[0];
    expect(monthly.nthWeekday).toBe(3);
    expect(monthly.weekday).toBe(5);
  });

  it("edits one-time, annual, and biweekly pattern fields", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    // One-time
    fireEvent.click(screen.getByText("One-time"));
    const oneTimeAmount = screen.getAllByPlaceholderText("0").find(
      (el) => (el as HTMLInputElement).value === ""
    )!;
    fireEvent.change(oneTimeAmount, { target: { value: "15000" } });

    // Annual
    fireEvent.click(screen.getByText("Annual"));
    fireEvent.change(screen.getByPlaceholderText("M"), { target: { value: "13" } }); // clamps to 12
    fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "15" } });

    // Biweekly
    fireEvent.click(screen.getByText("Biweekly"));

    const kinds = persisted().scenarios[0].patterns.map((p: any) => p.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["monthly", "oneTime", "yearly", "biweekly"])
    );
    const annual = persisted().scenarios[0].patterns.find((p: any) => p.kind === "yearly");
    expect(annual.month).toBe(12);
    expect(annual.day).toBe(15);
  });

  it("deletes an individual scenario pattern", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));
    fireEvent.click(screen.getByText("One-time"));
    expect(persisted().scenarios[0].patterns).toHaveLength(2);

    // Pattern rows each have their own ✕; the scenario header ✕ is first.
    const deletes = screen.getAllByText("✕");
    fireEvent.click(deletes[deletes.length - 1]);
    expect(persisted().scenarios[0].patterns).toHaveLength(1);
  });

  it("restores persisted mortgage state on remount", () => {
    const { unmount } = render(<MortgageTab />);
    fireEvent.change(screen.getByDisplayValue("300000"), {
      target: { value: "450000" },
    });
    unmount();

    render(<MortgageTab />);
    expect(screen.getByDisplayValue("450000")).toBeInTheDocument();
  });
});
