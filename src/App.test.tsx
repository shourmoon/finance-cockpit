// src/App.test.tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import App from "./App";

beforeEach(() => {
  window.localStorage.clear();
});

describe("App shell", () => {
  it("renders the dashboard by default with the safe-to-spend hero", () => {
    render(<App />);
    expect(screen.getByText("Safe to Spend today")).toBeInTheDocument();
    expect(screen.getByText("Balance today")).toBeInTheDocument();
    expect(screen.getByText("Upcoming Events")).toBeInTheDocument();
    // Default rules produce upcoming events.
    expect(screen.getAllByText(/Paycheck|Rent/).length).toBeGreaterThan(0);
    // Each event row shows its signed transaction amount next to the
    // running balance it produces.
    expect(screen.getAllByText(/^[+-]\$/).length).toBeGreaterThan(0);
  });

  it("shows the transaction amount to the left of the running balance it produces", () => {
    window.localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 2,
        account: { startingBalance: 500 },
        settings: { startDate: "2026-07-01", horizonDays: 10, minSafeBalance: 0 },
        rules: [],
        adhocTransactions: [
          { id: "t1", name: "Test Event", amount: -50, date: "2026-07-03" },
        ],
        overrides: {},
      })
    );
    render(<App />);

    const nameEl = screen.getByText("Test Event");
    const row = nameEl.closest("div")?.parentElement;
    expect(row).not.toBeNull();
    const rowText = row!.textContent ?? "";

    // Amount (the delta) comes before the balance it produces, ledger-style.
    expect(rowText).toContain("-$50.00");
    expect(rowText).toContain("$450.00");
    expect(rowText.indexOf("-$50.00")).toBeLessThan(rowText.indexOf("$450.00"));
    expect(within(row!).getByText("→")).toBeInTheDocument();
  });

  it("opens the ledger with a starting-balance line and runs a per-transaction balance", () => {
    window.localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 2,
        account: { startingBalance: 1000 },
        settings: { startDate: "2026-07-01", horizonDays: 30, minSafeBalance: 0 },
        rules: [],
        adhocTransactions: [
          { id: "a1", name: "Alpha", amount: 200, date: "2026-07-10" },
          { id: "a2", name: "Beta", amount: -50, date: "2026-07-10" },
        ],
        overrides: {},
      })
    );
    render(<App />);

    // Opening ledger line shows where the balance started.
    const opening = screen.getByText("Starting balance").parentElement;
    expect(opening?.textContent).toContain("$1,000.00");

    // Same-day rows run a progressing balance (1000 -> 1200 -> 1150),
    // not the day's closing balance repeated on every row.
    expect(screen.getByText("$1,200.00")).toBeInTheDocument();
    expect(screen.getByText("$1,150.00")).toBeInTheDocument();
  });

  it("shows each transaction's date inline on its own row, grouped by day", () => {
    window.localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 2,
        account: { startingBalance: 1000 },
        settings: { startDate: "2026-07-01", horizonDays: 30, minSafeBalance: 0 },
        rules: [],
        adhocTransactions: [
          { id: "a1", name: "Alpha", amount: 200, date: "2026-07-10" },
          { id: "a2", name: "Beta", amount: -50, date: "2026-07-10" },
        ],
        overrides: {},
      })
    );
    render(<App />);

    // The date sits inline in each transaction row, not on a wasted row.
    const alphaRow = screen.getByText("Alpha").closest("div")!.parentElement!;
    // Inline date is just the day number; month/year come from the banner.
    expect(alphaRow.firstElementChild?.textContent).toBe("10");
    expect(alphaRow.textContent).toContain("$1,200.00");
  });

  it("shows a top-up hint when the projection dips below the safety floor", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    // Default starting balance is 0 and there are outflow rules, so with a
    // positive floor the balance breaches it and a top-up is suggested.
    fireEvent.change(screen.getByRole("textbox", { name: /Minimum Safe Balance/i }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText(/Top up \$/)).toBeInTheDocument();
    // Wording explains the amount is sized for the horizon low, or the
    // simple case when the first breach is itself the lowest point.
    expect(
      screen.getByText(/above your floor|covers the whole horizon/)
    ).toBeInTheDocument();
  });

  it("shows a multi-transfer plan when the balance dips below the floor twice", () => {
    // Two separate below-floor stretches: an outflow drops below the floor,
    // an inflow recovers it, then a later outflow dips again. The dashboard
    // should offer one just-in-time transfer per stretch rather than a single
    // front-loaded top-up.
    window.localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 2,
        account: { startingBalance: 200 },
        settings: { startDate: "2026-07-01", horizonDays: 40, minSafeBalance: 100 },
        rules: [],
        adhocTransactions: [
          { id: "a1", name: "Dip one", amount: -150, date: "2026-07-05" },
          { id: "a2", name: "Refill", amount: 200, date: "2026-07-15" },
          { id: "a3", name: "Dip two", amount: -250, date: "2026-07-25" },
        ],
        overrides: {},
      })
    );
    render(<App />);
    expect(screen.getByText(/transfers keep you above your floor/)).toBeInTheDocument();
    expect(screen.getByText(/2 transfers/)).toBeInTheDocument();
    // The plan does not collapse into the single-hint wording.
    expect(screen.queryByText(/Top up \$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/rest stays earning yield/)
    ).toBeInTheDocument();
  });

  it("applying the single top-up hint creates an inflow and clears the hint", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("textbox", { name: /Minimum Safe Balance/i }), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText(/Top up \$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Apply transfer of/i }));

    // The hint is gone because the applied transfer covers the whole horizon.
    expect(screen.queryByText(/Top up \$/)).not.toBeInTheDocument();
    // The applied transfer shows up as a real inflow in Upcoming Events.
    expect(screen.getAllByText("Transfer from savings").length).toBeGreaterThan(0);

    const saved = JSON.parse(
      window.localStorage.getItem("finance-cockpit-app-state-v1")!
    );
    expect(
      saved.adhocTransactions.some(
        (t: { name: string; amount: number }) =>
          t.name === "Transfer from savings" && t.amount > 0
      )
    ).toBe(true);
  });

  it("applying one deposit of a multi-transfer plan drops it to a single remaining transfer", () => {
    window.localStorage.setItem(
      "finance-cockpit-app-state-v1",
      JSON.stringify({
        version: 2,
        account: { startingBalance: 200 },
        settings: { startDate: "2026-07-01", horizonDays: 40, minSafeBalance: 100 },
        rules: [],
        adhocTransactions: [
          { id: "a1", name: "Dip one", amount: -150, date: "2026-07-05" },
          { id: "a2", name: "Refill", amount: 200, date: "2026-07-15" },
          { id: "a3", name: "Dip two", amount: -250, date: "2026-07-25" },
        ],
        overrides: {},
      })
    );
    render(<App />);
    expect(screen.getByText(/2 transfers/)).toBeInTheDocument();

    const applyButtons = screen.getAllByRole("button", { name: /Apply transfer of/i });
    fireEvent.click(applyButtons[0]);

    // Applying the first stretch's deposit as a real inflow covers it, so
    // the plan collapses to the remaining single stretch (falls back to the
    // single-hint row) rather than a "N transfers" plan.
    expect(screen.queryByText(/transfers keep you above your floor/)).not.toBeInTheDocument();
    expect(screen.getByText(/Top up \$/)).toBeInTheDocument();
    expect(screen.getAllByText("Transfer from savings").length).toBeGreaterThan(0);
  });

  it("hides the top-up hint when the balance stays above the floor", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("textbox", { name: /Starting Balance/i }), {
      target: { value: "1000000" },
    });
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.queryByText(/Top up \$/)).not.toBeInTheDocument();
  });

  it("switches between tabs", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByText("Recurring Rules")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Mortgage Optimizer"));
    expect(screen.getByText(/Original loan terms/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText("Safe to Spend today")).toBeInTheDocument();
  });

  it("edits settings and persists them to localStorage", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));

    const startingBalance = screen.getByRole("textbox", { name: /Starting Balance/i });
    fireEvent.change(startingBalance, { target: { value: "5000" } });

    // Persisted state should reflect the new balance.
    const raw = window.localStorage.getItem("finance-cockpit-app-state-v1")!;
    expect(JSON.parse(raw).account.startingBalance).toBe(5000);

    // Dashboard reflects it too — shown both as the "Balance today" metric
    // and as the ledger's opening "Starting balance" line.
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getAllByText("$5,000.00").length).toBeGreaterThan(0);
  });

  it("updates horizon and minimum safe balance", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("spinbutton", { name: /Horizon/i }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Minimum Safe Balance/i }), {
      target: { value: "200" },
    });
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.settings.horizonDays).toBe(10);
    expect(raw.settings.minSafeBalance).toBe(200);
  });

  it("adds a new rule through the editor modal", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const before = screen.getAllByText("Edit").length;

    // Two + Add buttons exist now (rules card first, one-time transactions second).
    fireEvent.click(screen.getAllByText("+ Add")[0]);
    fireEvent.change(screen.getByDisplayValue("New Rule"), {
      target: { value: "Gym Membership" },
    });
    fireEvent.click(screen.getByText("Save"));

    expect(screen.getByText("Gym Membership")).toBeInTheDocument();
    expect(screen.getAllByText("Edit").length).toBe(before + 1);
  });

  it("edits and deletes an existing rule", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));

    expect(screen.getByText("Rent")).toBeInTheDocument();
    // Find the Rent rule row and open its editor.
    // ruleName -> ruleInfo -> ruleRow (which also holds the Edit button).
    const rentRow = screen.getByText("Rent").parentElement!.parentElement!;
    fireEvent.click(within(rentRow).getByText("Edit"));
    fireEvent.click(screen.getByText("Delete"));

    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
  });

  it("applies a per-event override from the dashboard", () => {
    render(<App />);
    // Click the first upcoming event row to open the override modal.
    const firstEvent = screen.getAllByText(/Paycheck|Rent|Groceries|Credit Card/)[0];
    fireEvent.click(firstEvent);

    expect(screen.getByText(/Override:/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/leave blank/), {
      target: { value: "-999" },
    });
    fireEvent.click(screen.getByText("Save"));

    // The overridden amount now appears in the event list, and an
    // asterisk marks the overridden row.
    expect(screen.getAllByText("-$999.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/\*/)).toBeInTheDocument();
  });

  it("adjusts a rule amount inline from the config list", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    // Rent default is -1500; change it inline.
    const rentAmount = screen.getByDisplayValue("-1500");
    fireEvent.change(rentAmount, { target: { value: "-1600" } });
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    const rent = raw.rules.find((r: any) => r.name === "Rent");
    expect(rent.amount).toBe(-1600);
  });

  it("adds a one-time transaction and shows it in the projection", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByText(/No one-time transactions yet/)).toBeInTheDocument();

    // The card has its own + Add button (the rules card has the other).
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);

    fireEvent.change(screen.getByLabelText("Transaction name"), {
      target: { value: "Car repair" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "-800" },
    });

    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions).toHaveLength(1);
    expect(raw.adhocTransactions[0]).toMatchObject({
      name: "Car repair",
      amount: -800,
    });

    // It appears in the dashboard's upcoming events (dated startDate = today).
    fireEvent.click(screen.getByText("Dashboard"));
    expect(screen.getByText("Car repair")).toBeInTheDocument();
    expect(screen.getAllByText("-$800.00").length).toBeGreaterThan(0);
  });

  it("deletes a one-time transaction", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(screen.getByLabelText("Transaction name")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Delete transaction"));
    expect(screen.getByText(/No one-time transactions yet/)).toBeInTheDocument();
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions).toHaveLength(0);
  });

  it("changing a transaction's date moves it in the persisted state", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    const addButtons = screen.getAllByText("+ Add");
    fireEvent.click(addButtons[addButtons.length - 1]);

    // The transaction row's date input is the last date input on the tab.
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const txnDate = dateInputs[dateInputs.length - 1];
    fireEvent.change(txnDate, { target: { value: "2026-08-01" } });

    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions[0].date).toBe("2026-08-01");
  });

  it("groups events under month separators", () => {
    render(<App />);
    // Default horizon is 90 days, so events span multiple months.
    const labels = screen.getAllByText(/^[A-Z][a-z]{2} '\d{2}$/);
    expect(labels.length).toBeGreaterThanOrEqual(2);
  });

  it("collapses long event lists behind a show-all button", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    // A long horizon produces well over 25 events.
    fireEvent.click(screen.getByText("180d"));
    fireEvent.click(screen.getByText("Dashboard"));

    const showAll = screen.getByText(/Show all \d+ events/);
    expect(showAll).toBeInTheDocument();
    fireEvent.click(showAll);
    expect(screen.queryByText(/Show all \d+ events/)).not.toBeInTheDocument();
  });

  it("quick-adds a one-time transaction from the dashboard", () => {
    render(<App />);
    fireEvent.click(screen.getByText("+ One-time"));
    fireEvent.change(screen.getByLabelText("Transaction name"), {
      target: { value: "Brakes" },
    });
    fireEvent.change(screen.getByLabelText("Transaction amount"), {
      target: { value: "-400" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(screen.getByText("Brakes")).toBeInTheDocument();
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.adhocTransactions).toHaveLength(1);
    expect(raw.adhocTransactions[0]).toMatchObject({ name: "Brakes", amount: -400 });
  });

  it("sets the horizon from a preset chip", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.click(screen.getByText("60d"));
    const raw = JSON.parse(window.localStorage.getItem("finance-cockpit-app-state-v1")!);
    expect(raw.settings.horizonDays).toBe(60);
  });

  it("restores persisted state on reload", () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    fireEvent.change(screen.getByRole("textbox", { name: /Starting Balance/i }), {
      target: { value: "4242" },
    });
    unmount();

    render(<App />);
    fireEvent.click(screen.getByText("Settings & Rules"));
    expect(screen.getByDisplayValue("4242")).toBeInTheDocument();
  });
});
