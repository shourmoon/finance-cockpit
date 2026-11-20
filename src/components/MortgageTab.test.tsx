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

/**
 * A real loan, stored. The tab used to invent a $300,000 one whenever
 * storage was empty, so every test below rendered against fabricated terms
 * and never noticed. The figures asserted here are the $300k loan's, kept
 * deliberately: it is a fine fixture, it was only ever a bad default.
 */
function seedLoan() {
  window.localStorage.setItem(
    "finance-cockpit-mortgage-v2",
    JSON.stringify({
      terms: {
        principal: 300_000,
        annualRate: 0.05,
        termMonths: 360,
        startDate: "2025-01-01",
        paymentFrequency: "monthly",
      },
      prepayments: [],
      asOfDate: "2025-01-01",
      checkpoints: [],
    })
  );
}

beforeEach(() => {
  window.localStorage.clear();
  seedLoan();
  // Deterministic ids for prepayment rows.
  let n = 0;
  vi.stubGlobal("crypto", { randomUUID: () => `id-${n++}` });
});

describe("with no loan entered", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("asks for the loan instead of inventing one", () => {
    // It used to open on a $300,000 loan at 5% starting 2025-01-01 and tell
    // the reader what they owed on it, down to the prepayment advice.
    render(<MortgageTab />);
    expect(screen.getByTestId("mortgage-setup")).toBeInTheDocument();
    expect(screen.queryByText("Baseline summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$1,610/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$300,000/)).not.toBeInTheDocument();
    // And nothing is written to storage on the strength of having looked.
    expect(
      window.localStorage.getItem("finance-cockpit-mortgage-v2")
    ).toBeNull();
  });

  it("opens the workbench once the terms are entered", () => {
    render(<MortgageTab />);
    fireEvent.change(screen.getByLabelText("Principal"), {
      target: { value: "420000" },
    });
    fireEvent.change(screen.getByLabelText("Interest rate (%)"), {
      target: { value: "4.25" },
    });
    fireEvent.change(screen.getByLabelText("Term (years)"), {
      target: { value: "25" },
    });

    // The loan's own start date is required: there is no honest default for
    // it, and guessing today would date every loan to the day it was typed.
    fireEvent.click(screen.getByText("Start tracking this loan"));
    expect(screen.getByText("Enter the date the loan started.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("First payment"), {
      target: { value: "2021-06-01" },
    });
    fireEvent.click(screen.getByText("Start tracking this loan"));

    expect(screen.queryByTestId("mortgage-setup")).not.toBeInTheDocument();
    expect(screen.getByText("Baseline summary")).toBeInTheDocument();
    expect(persisted().terms.principal).toBe(420000);
    expect(persisted().terms.annualRate).toBeCloseTo(0.0425, 10);
    expect(persisted().terms.termMonths).toBe(300);
    expect(persisted().terms.startDate).toBe("2021-06-01");
  });

  it("will not start tracking a loan with no principal", () => {
    // The button must not be a way to write the very zero-principal terms
    // the engine throws on; an empty schedule took the whole tab down once.
    render(<MortgageTab />);
    fireEvent.click(screen.getByText("Start tracking this loan"));
    expect(screen.getByTestId("mortgage-setup")).toBeInTheDocument();
    expect(
      window.localStorage.getItem("finance-cockpit-mortgage-v2")
    ).toBeNull();
  });
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

    it("survives a principal too small to buy a schedule", () => {
      // A `0` is caught by the commit guard, but any positive number gets
      // through — and a principal under the engine's 1e-6 epsilon buys no
      // schedule at all. The effective-rate solver throws on an empty
      // schedule, and thrown from a render-time useMemo that takes the
      // whole tab down. A rate that does not exist reads as absent.
      seedRealLoan();
      render(<MortgageTab />);
      fireEvent.change(screen.getByDisplayValue("680000"), {
        target: { value: "0.000000001" },
      });

      expect(screen.getByText("Baseline summary")).toBeInTheDocument();
      expect(screen.getByDisplayValue("0.000000001")).toBeInTheDocument();
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

  it("shows a months-saved column that adds up to its own total", () => {
    // Rule 4 in CLAUDE.md: a figure shown in two places must reconcile on
    // screen. Each cell here is rounded to whole months on its own, and on a
    // biweekly loan the underlying values are fractional (a period is 14
    // days, so months come out in 12/26ths). Independently rounded, the
    // increments stop adding up to the total the user can read directly
    // above them: this loan showed 8 + 18 + 10 = 36 against a total of 37.
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({
        terms: {
          principal: 680000,
          annualRate: 0.0475,
          termMonths: 360,
          startDate: "2023-06-01",
          paymentFrequency: "biweekly",
        },
        prepayments: [
          { date: "2024-01-15", amount: 10000 },
          { date: "2025-06-15", amount: 25000 },
          { date: "2026-02-15", amount: 15000 },
        ],
        asOfDate: "2026-06-01",
      })
    );
    render(<MortgageTab />);

    // "3 yrs 1 mo" / "+8 mos" / "—" -> a number of months.
    const months = (text: string): number => {
      const y = /(\d+)\s*yrs?/.exec(text);
      const m = /(\d+)\s*mos?/.exec(text);
      return (y ? +y[1] * 12 : 0) + (m ? +m[1] : 0);
    };

    const increments: number[] = [];
    for (let i = 0; ; i++) {
      const cell = screen.queryByTestId(`prepay-months-inc-${i}`);
      if (!cell) break;
      increments.push(months(cell.textContent ?? ""));
    }
    expect(increments).toHaveLength(3);

    const total = months(
      screen.getByTestId(`prepay-months-total-${increments.length - 1}`)
        .textContent ?? ""
    );
    expect(increments.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("says how much of a prepayment the loan handed back", () => {
    // Conservation, the first line of CLAUDE.md's money checklist. A
    // prepayment bigger than what is still owed is refunded by the servicer,
    // not kept. Before this the row showed the amount and a saving of
    // nothing, with no hint that $50,000 had come straight back.
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({
        terms: {
          principal: 400000,
          annualRate: 0.05,
          termMonths: 360,
          startDate: "2020-01-01",
        },
        prepayments: [
          { date: "2020-02-01", amount: 400000, note: "clears it" },
          { date: "2035-01-01", amount: 50000, note: "too late" },
        ],
        asOfDate: "2035-06-01",
      })
    );
    render(<MortgageTab />);

    // The loan was already gone, so the whole second prepayment came back.
    expect(screen.getByTestId("prepay-returned-1")).toHaveTextContent("$50,000");
    // And the payoff itself overshot by $963 — one payment had already
    // landed, so less than $400,000 was still owed.
    expect(screen.getByTestId("prepay-returned-0")).toHaveTextContent("$963");
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
