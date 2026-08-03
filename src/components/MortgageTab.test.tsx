// src/components/MortgageTab.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MortgageTab from "./MortgageTab";
import { colors } from "./ui";

// Every editable control in the app shares one input "chrome": the
// colors.inputBg fill and colors.inputBorder outline. The prepayment log is
// the densest part of the Mortgage tab, so this is where drift hides —
// assert the controls match the shared tokens rather than re-typing their
// own darker background/border.
const SHARED_INPUT = {
  backgroundColor: colors.inputBg,
  borderColor: colors.inputBorder,
};

beforeEach(() => {
  window.localStorage.clear();
  // Deterministic ids for prepayment rows.
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


  describe("visual cohesion of the prepayment controls", () => {

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
