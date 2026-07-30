// src/components/MortgageTab.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MortgageTab from "./MortgageTab";
import { colors } from "./ui";

// Every editable control in the app shares one input "chrome": the
// colors.inputBg fill and colors.inputBorder outline. The scenario and
// prepayment sections are the densest part of the Mortgage tab, so this
// is where drift hides — assert they match the shared tokens rather than
// re-typing their own darker background/border.
const SHARED_INPUT = {
  backgroundColor: colors.inputBg,
  borderColor: colors.inputBorder,
};

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
    expect(screen.getByText("Original Loan Terms")).toBeInTheDocument();
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

  describe("invalid terms entered mid-edit", () => {
    function seedRealLoan() {
      window.localStorage.setItem(
        "finance-cockpit-mortgage-v2",
        JSON.stringify({
          terms: {
            principal: 680000,
            annualRate: 0.0475,
            termMonths: 360,
            startDate: "2023-06-01",
          },
          prepayments: [{ date: "2024-01-15", amount: 10000, note: "bonus" }],
          asOfDate: "2025-06-01",
          scenarios: [],
        })
      );
    }

    it("survives a 0 in the principal field without crashing or losing the loan", () => {
      seedRealLoan();
      render(<MortgageTab />);
      fireEvent.change(screen.getByDisplayValue("680000"), { target: { value: "0" } });

      // The tab is still alive and still showing a real schedule.
      expect(screen.getByText("Baseline summary")).toBeInTheDocument();
      // The typed text is preserved so the user can keep typing...
      expect(screen.getByDisplayValue("0")).toBeInTheDocument();
      // ...but the persisted loan is untouched.
      expect(persisted().terms.principal).toBe(680000);
    });

    it("survives a negative rate without replacing the loan with defaults", () => {
      seedRealLoan();
      render(<MortgageTab />);
      fireEvent.change(screen.getByDisplayValue("4.75"), { target: { value: "-5" } });

      expect(screen.getByText("Baseline summary")).toBeInTheDocument();
      expect(persisted().terms.principal).toBe(680000);
      expect(persisted().terms.annualRate).toBe(0.0475);
      expect(persisted().terms.startDate).toBe("2023-06-01");
    });

    it("survives clearing a biweekly pattern's anchor date", () => {
      // Regression: with an amount already entered, emptying the anchor
      // date threw "Invalid ISO date: " out of parseIsoToDate, inside a
      // render-time useMemo, taking the whole tab down.
      const { container } = render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add scenario"));
      fireEvent.click(screen.getByText("Biweekly"));
      fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "300" } });

      const dates = Array.from(
        container.querySelectorAll('input[type="date"]')
      ) as HTMLInputElement[];
      // 0 = loan start, 1 = scenario as-of, 2 = the pattern's anchor date.
      fireEvent.change(dates[2], { target: { value: "" } });

      expect(screen.getByText("Baseline summary")).toBeInTheDocument();
    });

    it("recovers once a valid value is typed", () => {
      seedRealLoan();
      render(<MortgageTab />);
      const principal = screen.getByDisplayValue("680000");
      fireEvent.change(principal, { target: { value: "0" } });
      fireEvent.change(principal, { target: { value: "500000" } });
      expect(persisted().terms.principal).toBe(500000);
    });
  });

  it("switches the loan to biweekly and shortens the payoff", () => {
    render(<MortgageTab />);
    const before = screen.getByText("Payoff date").parentElement!.textContent!;

    fireEvent.change(screen.getByLabelText("Payment frequency"), {
      target: { value: "biweekly" },
    });

    expect(persisted().terms.paymentFrequency).toBe("biweekly");
    const after = screen.getByText("Payoff date").parentElement!.textContent!;
    expect(after).not.toBe(before);
    // Default 300k/5%/30y ends Dec '54 monthly; paying fortnightly retires
    // it Feb '50, just under five years sooner.
    expect(before).toMatch(/'54/);
    expect(after).toMatch(/'50/);
    expect(screen.getByText(/26 a year/)).toBeInTheDocument();

    // The headline figure is now the fortnightly amount, so it must not
    // still be labelled "Monthly payment".
    expect(screen.queryByText("Monthly payment")).not.toBeInTheDocument();
    expect(screen.getByText("Payment every 2 weeks")).toBeInTheDocument();
    expect(screen.getByText(/13 months’ worth/)).toBeInTheDocument();
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

  it("keeps the prepayment amount field blank while clearing it to retype, instead of flashing 0", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add prepayment"));
    const amountInput = screen.getByLabelText("Prepayment amount") as HTMLInputElement;

    fireEvent.change(amountInput, { target: { value: "500" } });
    expect(amountInput.value).toBe("500");

    // Selecting all and deleting to retype must not flash "0" mid-edit.
    fireEvent.change(amountInput, { target: { value: "" } });
    expect(amountInput.value).toBe("");

    fireEvent.change(amountInput, { target: { value: "1500" } });
    expect(amountInput.value).toBe("1500");
    expect(persisted().prepayments[0].amount).toBe(1500);
  });

  it("ignores a prepayment row with a zero amount when persisting", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add prepayment"));
    // Row exists in the UI but amount 0 => filtered out of persisted log.
    expect(persisted().prepayments).toHaveLength(0);
  });

  it("exposes the amount, note and delete controls on a prepayment row", () => {
    // Regression: on phones the note field and delete button used to be
    // clipped off-screen by the old fixed-column grid. Assert they are all
    // reachable and functional via their labels.
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add prepayment"));

    fireEvent.change(screen.getByLabelText("Prepayment amount"), {
      target: { value: "12000" },
    });
    // The note field is collapsed by default; reveal it first.
    fireEvent.click(screen.getByText("+ Add note"));
    fireEvent.change(screen.getByLabelText("Prepayment note"), {
      target: { value: "Tax refund" },
    });
    expect(persisted().prepayments[0]).toMatchObject({
      amount: 12000,
      note: "Tax refund",
    });

    fireEvent.click(screen.getByLabelText("Delete prepayment"));
    expect(persisted().prepayments).toHaveLength(0);
  });

  it("adds a scenario and shows its results, then deletes it", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));

    expect(screen.getByDisplayValue("Scenario 1")).toBeInTheDocument();
    expect(persisted().scenarios).toHaveLength(1);

    // A new scenario starts with no patterns.
    expect(screen.getByText(/No future prepayment patterns yet/)).toBeInTheDocument();
    expect(persisted().scenarios[0].patterns).toHaveLength(0);

    // Adding a Monthly pattern and giving it an amount is what creates the
    // first real pattern and starts showing results.
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.change(screen.getAllByPlaceholderText("0")[0], {
      target: { value: "200" },
    });
    expect(persisted().scenarios[0].patterns).toHaveLength(1);
    expect(screen.getByText(/Scenario comparison/)).toBeInTheDocument();

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
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    fireEvent.click(screen.getByText("One-time"));
    fireEvent.click(screen.getByText("Annual"));
    fireEvent.click(screen.getByText("Biweekly"));

    const patterns = persisted().scenarios[0].patterns;
    expect(patterns).toHaveLength(4);
    const kinds = patterns.map((p: any) => p.kind);
    expect(kinds).toContain("monthly");
    expect(kinds).toContain("oneTime");
    expect(kinds).toContain("yearly");
    expect(kinds).toContain("biweekly");
  });

  it("clicking a different cadence button adds an additional pattern rather than replacing the current one", () => {
    // Regression: a scenario used to seed a default monthly pattern, so
    // clicking a different cadence silently stacked a second pattern
    // instead of switching — this is the expected, intentional "add
    // another pattern" behavior now that scenarios start empty.
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));
    expect(persisted().scenarios[0].patterns).toHaveLength(0);

    fireEvent.click(screen.getByText("Biweekly"));
    expect(persisted().scenarios[0].patterns.map((p: any) => p.kind)).toEqual([
      "biweekly",
    ]);
  });

  it("edits the monthly pattern cadence, revealing conditional fields", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));

    // A freshly-added monthly pattern's cadence select starts on "Due date".
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

    // One-time: its amount field is the only "0"-placeholder input at this
    // point (the quick "Monthly extra" field is still empty/unset too, but
    // this is the one that belongs to the pattern card).
    fireEvent.click(screen.getByText("One-time"));
    const oneTimeAmount = screen.getAllByPlaceholderText("0").at(-1)!;
    fireEvent.change(oneTimeAmount, { target: { value: "15000" } });

    // Annual
    fireEvent.click(screen.getByText("Annual"));
    fireEvent.change(screen.getByPlaceholderText("M"), { target: { value: "13" } }); // clamps to 12
    fireEvent.change(screen.getByPlaceholderText("D"), { target: { value: "15" } });

    // Biweekly
    fireEvent.click(screen.getByText("Biweekly"));

    const kinds = persisted().scenarios[0].patterns.map((p: any) => p.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["oneTime", "yearly", "biweekly"])
    );
    const annual = persisted().scenarios[0].patterns.find((p: any) => p.kind === "yearly");
    expect(annual.month).toBe(12);
    expect(annual.day).toBe(15);
  });

  it("deletes an individual scenario pattern", () => {
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("+ Add scenario"));
    fireEvent.click(screen.getByText("One-time"));
    fireEvent.click(screen.getByText("Annual"));
    expect(persisted().scenarios[0].patterns).toHaveLength(2);

    // Pattern rows each have their own ✕; the scenario header ✕ is first.
    const deletes = screen.getAllByText("✕");
    fireEvent.click(deletes[deletes.length - 1]);
    expect(persisted().scenarios[0].patterns).toHaveLength(1);
  });

  describe("visual cohesion of scenario & prepayment controls", () => {
    it("scenario pattern-card inputs use the shared app input chrome", () => {
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add scenario"));
      fireEvent.click(screen.getByRole("button", { name: "Monthly" }));

      // A monthly pattern card's Label input and Cadence <select> render
      // through the pattern-card control style, which historically used
      // the page background (#020617) and card border (#27272a) — nothing
      // like the rest of the app's inputs.
      expect(screen.getByDisplayValue("Monthly extra")).toHaveStyle(SHARED_INPUT);
      expect(screen.getByDisplayValue("Due date")).toHaveStyle(SHARED_INPUT);
    });

    it("every scenario pattern kind's controls share that chrome", () => {
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add scenario"));
      fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
      fireEvent.click(screen.getByText("One-time"));
      fireEvent.click(screen.getByText("Annual"));
      fireEvent.click(screen.getByText("Biweekly"));

      // Collect every labelled text/number control across all pattern
      // kinds plus the cadence select. Date fields already use the
      // shared ui.input, so they act as the reference the rest must match.
      const controls = [
        ...screen.getAllByPlaceholderText("Description"), // labels
        ...screen.getAllByPlaceholderText("0"), // amounts (+ monthly-extra)
        ...screen.getAllByPlaceholderText("M"), // annual month
        ...screen.getAllByPlaceholderText("D"), // annual day
        ...screen.getAllByPlaceholderText("From"), // annual first year
        ...screen.getAllByPlaceholderText("To"), // annual last year
        screen.getByDisplayValue("Due date"), // monthly cadence select
      ];
      // Sanity: we actually gathered a representative spread of controls.
      expect(controls.length).toBeGreaterThan(8);
      for (const el of controls) expect(el).toHaveStyle(SHARED_INPUT);
    });

    it("prepayment amount and note inputs use the same chrome", () => {
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add prepayment"));
      expect(screen.getByLabelText("Prepayment amount")).toHaveStyle(SHARED_INPUT);
      fireEvent.click(screen.getByText("+ Add note"));
      expect(screen.getByLabelText("Prepayment note")).toHaveStyle(SHARED_INPUT);
    });

    it("keeps the note field collapsed behind an Add note affordance", () => {
      // The optional note used to render an empty input on every row,
      // bulking up the log. It should stay hidden until the user opts in.
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add prepayment"));
      expect(screen.queryByLabelText("Prepayment note")).toBeNull();

      fireEvent.click(screen.getByText("+ Add note"));
      const note = screen.getByLabelText("Prepayment note");
      expect(note).toBeInTheDocument();
      // Once revealed, the affordance is gone (the input replaces it).
      expect(screen.queryByText("+ Add note")).toBeNull();
    });

    it("shows the note input directly for a prepayment that already has a note", () => {
      // A persisted note should render expanded on load, no tap needed.
      window.localStorage.setItem(
        "finance-cockpit-mortgage-v2",
        JSON.stringify({
          version: 2,
          terms: {
            principal: 300000,
            annualRate: 0.05,
            termMonths: 360,
            startDate: "2025-01-01",
          },
          prepayments: [
            { id: "p1", date: "2025-02-01", amount: 5000, note: "Bonus" },
          ],
          scenarios: [],
          asOfDate: "2025-01-01",
        })
      );
      render(<MortgageTab />);
      expect(screen.getByLabelText("Prepayment note")).toHaveValue("Bonus");
      expect(screen.queryByText("+ Add note")).toBeNull();
    });

    it("prepayment date field is labelled and reserves enough width to show the full date", () => {
      // Regression: on phones the date input rendered too narrow and
      // clipped the year ("12/23/202"). It must be accessible by name and
      // carry a min-width that fits MM/DD/YYYY.
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add prepayment"));
      const dateInput = screen.getByLabelText("Prepayment date");
      expect(dateInput).toHaveStyle({ minWidth: "150px" });
    });

    it("scenario name and pattern amount inputs use the same chrome", () => {
      render(<MortgageTab />);
      fireEvent.click(screen.getByText("+ Add scenario"));
      expect(screen.getByDisplayValue("Scenario 1")).toHaveStyle(SHARED_INPUT);
      fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
      for (const el of screen.getAllByPlaceholderText("0")) {
        expect(el).toHaveStyle(SHARED_INPUT);
      }
    });
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
