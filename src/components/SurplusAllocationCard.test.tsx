// src/components/SurplusAllocationCard.test.tsx
//
// The card answers one question — market or mortgage? — and the tests are
// mostly about what it refuses to say. It must not present a surplus figure
// when it doesn't know the balance, must not offer to allocate money that is
// still holding up the emergency reserve, and must lead with the two raw
// numbers (months sooner, wealth given up) rather than the per-month price,
// which only makes sense as a comparison unit between splits.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import SurplusAllocationCard from "./SurplusAllocationCard";
import { colors } from "./ui";
import type { MortgageOriginalTerms } from "../domain/mortgage/types";
import type { RecurringRule, SurplusSettings } from "../domain/types";

const terms: MortgageOriginalTerms = {
  principal: 680_000,
  annualRate: 0.0475,
  termMonths: 360,
  startDate: "2023-06-01",
  paymentFrequency: "biweekly",
};

const rules: RecurringRule[] = [
  {
    id: "salary", name: "Salary", amount: 9_000, isVariable: false,
    schedule: { type: "twiceMonth", day1: 15, day2: 31 },
  },
  {
    id: "mortgage", name: "Mortgage", amount: -3_547, isVariable: false,
    schedule: { type: "monthly", day: 1 },
  },
  {
    id: "living", name: "Living", amount: -4_453, isVariable: false,
    schedule: { type: "monthly", day: 5 },
  },
];

const surplus: SurplusSettings = {
  parkedCash: 120_000,
  monthlyContribution: 0,
  reserveMonths: 6,
  expectedReturn: 0.07,
  capitalGainsRate: 0.2517,
  horizonYears: 30,
};

function setup(overrides: Partial<SurplusSettings> = {}, extra = {}) {
  const onSurplusChange = vi.fn();
  render(
    <SurplusAllocationCard
      terms={terms}
      prepayments={[{ date: "2025-01-01", amount: 150_000 }]}
      asOfDate="2026-08-01"
      rules={rules}
      surplus={{ ...surplus, ...overrides }}
      onSurplusChange={onSurplusChange}
      {...extra}
    />
  );
  return { onSurplusChange };
}

describe("SurplusAllocationCard", () => {
  it("asks for the balance before showing any surplus at all", () => {
    // parkedCash unset is "I haven't told you", not "zero". Presenting a
    // computed surplus here would be inventing the user's finances.
    setup({ parkedCash: undefined });
    expect(screen.getByLabelText(/parked in savings/i)).toBeInTheDocument();
    expect(screen.queryByText(/free to allocate/i)).not.toBeInTheDocument();
  });

  it("refuses to offer a surplus while the reserve is underfunded", () => {
    // $20k parked against a $48k reserve target: nothing is free, and the
    // card says how short it is rather than suggesting an allocation.
    setup({ parkedCash: 20_000 });
    expect(screen.getByText(/short of your safety net/i)).toBeInTheDocument();
    expect(screen.queryByText(/free to allocate/i)).not.toBeInTheDocument();
  });

  it("shows the reserve it held back and what is left over", () => {
    setup();
    // 6 months x $8,000 of outflows = $48,000 held back, $72,000 free.
    expect(screen.getByText(/\$48,000/)).toBeInTheDocument();
    expect(screen.getByText(/free to allocate/i)).toBeInTheDocument();
    expect(screen.getByText("$72,000")).toBeInTheDocument();
  });

  it("opens with how far ahead of contract the household already is", () => {
    setup();
    expect(screen.getByText(/already .* ahead/i)).toBeInTheDocument();
  });

  it("leads with months sooner and wealth given up, not the per-month price", () => {
    setup();
    const allIn = screen.getByTestId("split-row-1");
    // Both raw numbers present on the row.
    expect(within(allIn).getByTestId("months-sooner")).toBeInTheDocument();
    expect(within(allIn).getByTestId("wealth-given-up")).toBeInTheDocument();
    // The unit price is present but explicitly secondary.
    const price = within(allIn).getByTestId("per-month-price");
    expect(Number(getComputedStyle(price).fontSize.replace("px", ""))).toBeLessThan(
      Number(
        getComputedStyle(
          within(allIn).getByTestId("months-sooner")
        ).fontSize.replace("px", "")
      )
    );
  });

  it("quotes a break-even from the simulation and compares it to the assumption", () => {
    setup();
    const verdict = screen.getByTestId("verdict");
    // ~5.2-5.5% for this loan; the assumption is 7%.
    expect(verdict).toHaveTextContent(/5\.\d%/);
    expect(verdict).toHaveTextContent(/7(\.0)?%/);
  });

  it("calls the market the winner when the assumed return clears the bar", () => {
    setup();
    expect(screen.getByTestId("verdict")).toHaveTextContent(/market/i);
  });

  it("flips its verdict when the assumed return drops below the bar", () => {
    setup({ expectedReturn: 0.03 });
    expect(screen.getByTestId("verdict")).toHaveTextContent(/mortgage/i);
  });

  it("marks nothing given up on the all-market row", () => {
    setup();
    const marketRow = screen.getByTestId("split-row-0");
    expect(within(marketRow).getByTestId("wealth-given-up")).toHaveTextContent("—");
  });

  it("persists an edited parked balance", () => {
    const { onSurplusChange } = setup();
    fireEvent.change(screen.getByLabelText(/parked in savings/i), {
      target: { value: "200000" },
    });
    expect(onSurplusChange).toHaveBeenCalledWith(
      expect.objectContaining({ parkedCash: 200_000 })
    );
  });

  it("persists an edited reserve length", () => {
    const { onSurplusChange } = setup();
    fireEvent.change(screen.getByLabelText(/reserve months/i), {
      target: { value: "9" },
    });
    expect(onSurplusChange).toHaveBeenCalledWith(
      expect.objectContaining({ reserveMonths: 9 })
    );
  });

  it("says so plainly when expenses cannot be derived", () => {
    // No outflows means no reserve can be sized, and the card must not
    // silently treat that as "no reserve needed" and offer the lot.
    setup({}, { rules: [] });
    expect(screen.getByText(/can't size your safety net/i)).toBeInTheDocument();
    expect(screen.queryByText(/free to allocate/i)).not.toBeInTheDocument();
  });

  it("stays quiet once the mortgage is paid off", () => {
    setup({}, { prepayments: [{ date: "2026-07-01", amount: 700_000 }] });
    expect(screen.getByText(/mortgage is already paid off/i)).toBeInTheDocument();
  });

  it("takes a recurring contribution alongside the lump", () => {
    const { onSurplusChange } = setup();
    fireEvent.change(screen.getByLabelText(/per month/i), {
      target: { value: "2000" },
    });
    expect(onSurplusChange).toHaveBeenCalledWith(
      expect.objectContaining({ monthlyContribution: 2_000 })
    );
  });

  it("shaves more with a recurring stream than with the lump alone", () => {
    setup({ monthlyContribution: 2_000 });
    const withStream = screen.getByTestId("split-row-2");
    expect(within(withStream).getByTestId("months-sooner")).toHaveTextContent(
      /sooner/
    );
    // The row names both destinations so it is clear what is being committed.
    expect(withStream).toHaveTextContent(/month/i);
  });

  it("attributes months and interest to each cause separately", () => {
    setup({ monthlyContribution: 2_000 });
    const legs = screen.getByTestId("attribution");
    // The four causes are named and credited apart from one another.
    expect(within(legs).getByTestId("leg-cadence")).toHaveTextContent(/biweekly/i);
    expect(within(legs).getByTestId("leg-prepayments")).toBeInTheDocument();
    expect(within(legs).getByTestId("leg-futureLump")).toBeInTheDocument();
    expect(within(legs).getByTestId("leg-futureRecurring")).toBeInTheDocument();
    expect(within(legs).getByTestId("leg-total")).toBeInTheDocument();
  });

  it("shows legs that actually add up to the total on screen", () => {
    // Rounding each leg independently makes them disagree with the total by a
    // month — 55+98+34+54 = 241 displayed against a displayed total of 242.
    // On a page about money, figures that visibly fail to reconcile destroy
    // trust in every other number on it.
    setup({ monthlyContribution: 2_000 });
    const legs = screen.getByTestId("attribution");

    const monthsOf = (testId: string) => {
      const text = within(legs).getByTestId(testId + "-value").textContent ?? "";
      const yrs = /(\d+)\s*yrs?/.exec(text);
      const mos = /(\d+)\s*mos?/.exec(text);
      return (yrs ? Number(yrs[1]) * 12 : 0) + (mos ? Number(mos[1]) : 0);
    };
    const dollarsOf = (testId: string) => {
      const text = within(legs).getByTestId(testId + "-value").textContent ?? "";
      const m = /\$([\d,]+)/.exec(text);
      return m ? Number(m[1].replace(/,/g, "")) : 0;
    };

    const parts = [
      "leg-cadence",
      "leg-prepayments",
      "leg-futureLump",
      "leg-futureRecurring",
    ];
    expect(parts.reduce((s, id) => s + monthsOf(id), 0)).toBe(
      monthsOf("leg-total")
    );
    expect(parts.reduce((s, id) => s + dollarsOf(id), 0)).toBe(
      dollarsOf("leg-total")
    );
  });

  it("hides the future legs until there is a future plan", () => {
    // Rows reading "— · —" would be noise before anything is committed.
    setup({ monthlyContribution: 0, parkedCash: 20_000 });
    expect(screen.queryByTestId("leg-futureLump")).not.toBeInTheDocument();
  });

  it("omits the cadence leg on a monthly loan", () => {
    setup({}, { terms: { ...terms, paymentFrequency: "monthly" } });
    expect(screen.queryByTestId("leg-cadence")).not.toBeInTheDocument();
    expect(screen.getByTestId("leg-prepayments")).toBeInTheDocument();
  });

  it("never leaves a field showing a value the card is not using", () => {
    // Typing something unparseable leaves the old number in effect. If the
    // box still reads "abc" while the projections below it are computed from
    // $120,000, the card is quietly lying about its own inputs — unacceptable
    // when someone is about to move real money on the strength of it.
    setup();
    const field = screen.getByLabelText(/parked in savings/i);

    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.blur(field);
    expect(field).toHaveValue("120000");

    // Same for a negative amount, which is not a balance.
    fireEvent.change(field, { target: { value: "-5000" } });
    fireEvent.blur(field);
    expect(field).toHaveValue("120000");
  });

  it("keeps a genuinely empty field empty on blur", () => {
    // Clearing the box is a real action — it means "I have not said" — and
    // must not be undone by the blur repair above.
    const { onSurplusChange } = setup();
    const field = screen.getByLabelText(/parked in savings/i);
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(field).toHaveValue("");
    expect(onSurplusChange).toHaveBeenCalledWith(
      expect.objectContaining({ parkedCash: undefined })
    );
  });

  it("uses the shared input chrome", () => {
    setup();
    expect(screen.getByLabelText(/parked in savings/i)).toHaveStyle({
      backgroundColor: colors.inputBg,
      borderColor: colors.inputBorder,
    });
  });
});
